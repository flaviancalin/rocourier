// app/services/fgo.server.js
// FGO invoicing. Two API generations (docs in docs/api/fgo):
//   • v2 REST (current) — https://api.fgo.ro/v2, test https://api-testuat.fgo.ro/v2.
//     Keys look like "fgo_api_v1.…" / "fgo_test_api_v1.…" and are generated in
//     FGO → Contul meu → Chei API. Headers: Authorization: Bearer <key>, Fgo-Cod-Unic,
//     and Fgo-Url-Platforma (the store address registered in Setări eCommerce → API)
//     on operations that change an invoice. Errors are application/problem+json.
//   • v1 (deprecated, still running) — hash-signed POSTs, used for older private keys.
// FGO allows one call per second per operation and company; calls for a CUI are serialized.
import crypto from "node:crypto";
import { normalizeRoCounty, normalizeName } from "../utils/address.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
export const isV2Key = (key) => /^fgo_(test_)?api_/i.test(String(key || ""));
export const cleanCui = (cui) => String(cui || "").toUpperCase().replace(/^RO/, "").replace(/\D/g, "");

// One FGO call at a time per CUI, at least 1s apart (API limit).
const queues = new Map();
function throttled(cui, fn) {
  const prev = queues.get(cui) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try { return await fn(); } finally { await new Promise((r) => setTimeout(r, 1000)); }
  });
  queues.set(cui, next);
  return next;
}

// ═════════════════════════════════════════════════════════════════════════════
// v2
// ═════════════════════════════════════════════════════════════════════════════
const V2 = { production: "https://api.fgo.ro", test: "https://api-testuat.fgo.ro" };

export class FgoError extends Error {
  constructor(message, { status, type, code } = {}) { super(message); this.status = status; this.type = type; this.code = code; }
}

// problem+json → one readable sentence
export function problemMessage(p, status) {
  const parts = [];
  if (p?.motiv?.mesaj) parts.push(p.motiv.mesaj);
  else if (p?.detail) parts.push(p.detail);
  else if (p?.title) parts.push(p.title);
  for (const v of p?.validation_errors || []) {
    for (const i of v.issues || []) parts.push(`${v.pointer || v.name || ""}: ${i.message}`.replace(/^: /, ""));
  }
  return `FGO: ${parts.join(" · ") || `eroare ${status}`}`;
}

async function v2Request(method, path, { cui, privateKey, sandbox = false, platformUrl = null, body = null }) {
  const base = process.env.FGO_API_BASE || (sandbox ? V2.test : V2.production);
  const headers = {
    Authorization: `Bearer ${privateKey}`,
    "Fgo-Cod-Unic": cleanCui(cui),
    Accept: "application/json",
    ...(platformUrl ? { "Fgo-Url-Platforma": platformUrl } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  return throttled(cleanCui(cui), async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 429 && attempt < 2) {
        const wait = Math.min(10, Number(res.headers.get("retry-after")) || 1);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      if (!res.ok) {
        throw new FgoError(data ? problemMessage(data, res.status) : `FGO [${res.status}]: ${text.slice(0, 200)}`,
          { status: res.status, type: data?.type, code: data?.motiv?.cod });
      }
      return data?.data ?? data;
    }
  });
}

// County name → FGO county code ("Dolj" → "DJ"); public nomenclature, cached.
let countyCodes = null;
async function countyCode(county, sandbox) {
  if (!county) return undefined;
  if (!countyCodes) {
    const base = process.env.FGO_API_BASE || (sandbox ? V2.test : V2.production);
    const res = await fetch(`${base}/v2/nomenclatoare/judete?fields=nume`);
    const data = (await res.json()).data || [];
    countyCodes = new Map(data.map((j) => [normalizeName(j.nume), j.cod]));
  }
  return countyCodes.get(normalizeName(normalizeRoCounty(county))) || undefined;
}

// Normalized Picklo order → POST /v2/facturi body (exported for tests).
export function buildFgoInvoiceV2({ series, tva, currency, order, countyCode: judet }) {
  const vatPct = Number.isFinite(Number.parseFloat(tva)) ? Number.parseFloat(tva) : 21;
  const isCompany = !!(order.customerCompany && order.customerVatCode);
  const ro = /^(ro|romania|românia)$/i.test(order.shippingCountry || "RO");
  const line = (denumire, extra, qty, total) => ({
    tip: "Articol", denumire: String(denumire).slice(0, 1000), ...extra, um: "BUC",
    nr_produse: qty, cota_tva: Math.round(vatPct * 100) / 10000,
    // Shopify prices include VAT → FGO works the unit price out of the total paid
    pret_total: round2(total),
  });
  const articole = order.lineItems.map((i) => line(i.name, i.sku ? { cod_articol: String(i.sku).slice(0, 128) } : {}, i.quantity, i.unitPrice * i.quantity));
  if (order.shippingTotal > 0) articole.push(line("Transport", {}, 1, order.shippingTotal));
  articole.forEach((a, idx) => { a.nr_crt = idx + 1; });

  const client = {
    tip: isCompany ? "PJ" : "PF",
    denumire: ((isCompany ? order.customerCompany : order.customerName) || "Client").slice(0, 255),
    ...(isCompany ? { cod_unic: String(order.customerVatCode), ...(order.customerRegCom ? { nr_reg_com: order.customerRegCom } : {}) } : {}),
    tara: ro ? "ROMANIA" : String(order.shippingCountry || "").toUpperCase(),
    ...(ro && judet ? { cod_judet: judet } : {}),
    ...(order.shippingCity ? { localitate: order.shippingCity } : {}),
    ...((isCompany && order.companyAddress) || order.shippingAddress1 ? { adresa: (isCompany && order.companyAddress) || order.shippingAddress1 } : {}),
    ...(order.customerEmail ? { email: order.customerEmail } : {}),
    ...(order.customerPhone ? { telefon: order.customerPhone } : {}),
  };
  return {
    serie: series,
    valuta: currency || "RON",
    tip_factura: "F",
    data_emitere: today(),
    text: `Comanda Shopify ${order.shopifyOrderName || ""}`.trim(),
    ...(order.idempotencyKey ? { id_extern: String(order.idempotencyKey).slice(-36), verificare_duplicat: true } : {}),
    client,
    articole,
  };
}

async function v2Link(creds, series, number) {
  const d = await v2Request("POST", `/v2/facturi/${encodeURIComponent(series)}/${encodeURIComponent(number)}/genereaza-link-de-descarcare`, creds).catch(() => null);
  return d?.link || null;
}

const inv = (series, number) => `/v2/facturi/${encodeURIComponent(series)}/${encodeURIComponent(number)}`;

// ═════════════════════════════════════════════════════════════════════════════
// v1 (deprecated)
// ═════════════════════════════════════════════════════════════════════════════
const V1 = { production: "https://api.fgo.ro/v1", test: "https://api-testuat.fgo.ro/v1" };
const V1_PLATFORM_URL = (process.env.SHOPIFY_APP_URL || "https://picklo.app").replace(/\/$/, "");

export const fgoHash = (cui, privateKey, tail) =>
  crypto.createHash("sha1").update(`${cui}${privateKey}${tail}`, "utf8").digest("hex").toUpperCase();
const signed = (cui, privateKey, number) => ({ CodUnic: String(cui), Hash: fgoHash(cui, privateKey, String(number)) });

async function v1Request(path, body, { sandbox = false, platformUrl = null } = {}) {
  const base = process.env.FGO_API_BASE_V1 || (sandbox ? V1.test : V1.production);
  return throttled(body.CodUnic, async () => {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, PlatformaUrl: platformUrl || V1_PLATFORM_URL }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`FGO [${res.status}]: ${text.slice(0, 200)}`); }
    if (!data.Success) {
      // v1 puts .NET stack traces in Message — keep only the human part
      const msg = String(data.Message || `eroare ${res.status}`).split(/\r?\n/)[0].replace(/^System\.\w*Exception:\s*/, "");
      throw new Error(`FGO: ${msg}`);
    }
    return data;
  });
}

// Normalized Picklo order → v1 "factura/emitere" body (exported for tests).
export function buildFgoInvoice({ cui, privateKey, series, tva, currency, order }) {
  const vat = Number.isFinite(Number.parseFloat(tva)) ? Number.parseFloat(tva) : 21;
  const isCompany = !!(order.customerCompany && order.customerVatCode);
  const clientName = (isCompany ? order.customerCompany : order.customerName) || "Client";
  const country = /^(ro|romania|românia)$/i.test(order.shippingCountry || "RO") ? "RO" : order.shippingCountry;
  const lines = order.lineItems.map((i) => ({
    Denumire: String(i.name).slice(0, 1000),
    ...(i.sku ? { CodArticol: String(i.sku).slice(0, 128) } : {}),
    NrProduse: i.quantity, UM: "BUC", CotaTVA: vat, PretTotal: round2(i.unitPrice * i.quantity),
  }));
  if (order.shippingTotal > 0) lines.push({ Denumire: "Transport", NrProduse: 1, UM: "BUC", CotaTVA: vat, PretTotal: round2(order.shippingTotal) });
  return {
    CodUnic: String(cui),
    Hash: fgoHash(cui, privateKey, clientName),
    Serie: series, Valuta: currency || "RON", TipFactura: "Factura", DataEmitere: today(),
    ...(order.idempotencyKey ? { IdExtern: String(order.idempotencyKey).slice(-36), VerificareDuplicat: true } : {}),
    Text: `Comanda Shopify ${order.shopifyOrderName || ""}`.trim(),
    Client: {
      Denumire: clientName, Tip: isCompany ? "PJ" : "PF", Tara: country || "RO",
      ...(country === "RO" ? { Judet: normalizeRoCounty(order.shippingCounty) || "Bucuresti" } : {}),
      ...(order.shippingCity ? { Localitate: order.shippingCity } : {}),
      ...((isCompany && order.companyAddress) || order.shippingAddress1 ? { Adresa: (isCompany && order.companyAddress) || order.shippingAddress1 } : {}),
      ...(order.customerEmail ? { Email: order.customerEmail } : {}),
      ...(order.customerPhone ? { Telefon: order.customerPhone } : {}),
      ...(isCompany ? { CodUnic: order.customerVatCode, ...(order.customerRegCom ? { NrRegCom: order.customerRegCom } : {}) } : {}),
    },
    Continut: lines,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Public API — picks v2 or v1 from the key format
// creds: { cui, privateKey, sandbox, platformUrl }
// ═════════════════════════════════════════════════════════════════════════════
export async function fgoTestConnection({ cui, privateKey, sandbox = false }) {
  if (isV2Key(privateKey)) {
    const id = await v2Request("GET", "/v2/identitate", { cui, privateKey, sandbox });
    const missing = ["facturi:emitere", "facturi:anulare"].filter((d) => !(id?.drepturi || []).includes(d));
    if (missing.length) throw new Error(`FGO: cheia nu are dreptul ${missing.join(", ")} — generează o cheie cu aceste drepturi.`);
    return { success: true, rights: id.drepturi };
  }
  // v1 has no "who am I": ask for an invoice that can't exist. Bad credentials fail on the
  // company code or hash; good ones fail on the missing invoice.
  try {
    await v1Request("factura/getstatus", { ...signed(cui, privateKey, "0"), Serie: "PICKLOTEST", Numar: "0" }, { sandbox });
  } catch (e) {
    if (/cod(ul)? unic|hash|autentific|neasociat|nu este asociat|api/i.test(e.message)) throw e;
  }
  return { success: true };
}

export async function fgoCreateInvoice({ cui, privateKey, sandbox = false, platformUrl = null, series, tva, currency, order }) {
  const creds = { cui, privateKey, sandbox, platformUrl };
  if (isV2Key(privateKey)) {
    const body = buildFgoInvoiceV2({ series, tva, currency, order, countyCode: await countyCode(order.shippingCounty, sandbox).catch(() => undefined) });
    let doc;
    try {
      doc = await v2Request("POST", "/v2/facturi", { ...creds, body });
    } catch (e) {
      // Same order sent twice: FGO refuses and names the existing invoice — reuse it
      const m = e.code === "factura_duplicata" && /factura\s+(\S+)\s+(\d+)/i.exec(e.message);
      if (!m) throw e;
      doc = { serie: m[1], numar: m[2] };
    }
    return { series: doc.serie, number: String(doc.numar), url: await v2Link(creds, doc.serie, doc.numar) };
  }
  const data = await v1Request("factura/emitere", buildFgoInvoice({ cui, privateKey, series, tva, currency, order }), { sandbox, platformUrl });
  return { series: data.Factura?.Serie || series, number: String(data.Factura?.Numar), url: data.Factura?.Link || null };
}

export async function fgoReverseInvoice({ cui, privateKey, sandbox = false, platformUrl = null, series, number }) {
  const creds = { cui, privateKey, sandbox, platformUrl };
  if (isV2Key(privateKey)) {
    const d = await v2Request("POST", `${inv(series, number)}/storneaza`, { ...creds, body: {} });
    return { series: d.serie, number: String(d.numar), url: await v2Link(creds, d.serie, d.numar) };
  }
  const data = await v1Request("factura/stornare", { ...signed(cui, privateKey, number), Serie: series, Numar: String(number) }, { sandbox, platformUrl });
  return { series: data.Factura?.Serie || series, number: String(data.Factura?.Numar), url: data.Factura?.Link || null };
}

export async function fgoCancelInvoice({ cui, privateKey, sandbox = false, platformUrl = null, series, number }) {
  if (isV2Key(privateKey)) return void await v2Request("POST", `${inv(series, number)}/anuleaza`, { cui, privateKey, sandbox, platformUrl });
  await v1Request("factura/anulare", { ...signed(cui, privateKey, number), Serie: series, Numar: String(number) }, { sandbox, platformUrl });
}

export async function fgoDeleteInvoice({ cui, privateKey, sandbox = false, platformUrl = null, series, number }) {
  if (isV2Key(privateKey)) return void await v2Request("DELETE", inv(series, number), { cui, privateKey, sandbox, platformUrl });
  await v1Request("factura/stergere", { ...signed(cui, privateKey, number), Serie: series, Numar: String(number) }, { sandbox, platformUrl });
}

export async function fgoGetInvoiceLink({ cui, privateKey, sandbox = false, series, number }) {
  if (isV2Key(privateKey)) return v2Link({ cui, privateKey, sandbox }, series, number);
  const data = await v1Request("factura/print", { ...signed(cui, privateKey, number), Serie: series, Numar: String(number) }, { sandbox });
  return data.Factura?.Link || null;
}

export async function fgoGetInvoice({ cui, privateKey, sandbox = false, series, number }) {
  return v2Request("GET", `${inv(series, number)}?fields=valoare,valoare_achitata,incasari(suma_incasata,data_incasare)`, { cui, privateKey, sandbox });
}

// Payments via API need FGO Premium/Enterprise. COD money reaches the merchant by bank
// transfer from the courier, hence "Banca" (GET /v2/nomenclatoare/tipuri-incasare).
export async function fgoCollectInvoice({ cui, privateKey, sandbox = false, series, number, amount, type = "Banca" }) {
  if (isV2Key(privateKey)) {
    return void await v2Request("POST", `${inv(series, number)}/incasari`, {
      cui, privateKey, sandbox, body: { suma_incasata: round2(amount || 0), tip_incasare: type, data_incasare: today() },
    });
  }
  await v1Request("factura/incasare", {
    ...signed(cui, privateKey, number), SerieFactura: series, NumarFactura: String(number),
    TipIncasare: type, SumaIncasata: round2(amount || 0), DataIncasare: new Date().toISOString().replace("T", " ").slice(0, 19),
  }, { sandbox });
}

// Writes the courier AWB on the invoice (shown in FGO and on the document).
export async function fgoAttachAwb({ cui, privateKey, sandbox = false, series, number, awbNumber }) {
  if (isV2Key(privateKey)) return void await v2Request("PUT", `${inv(series, number)}/awb`, { cui, privateKey, sandbox, body: { awb: String(awbNumber) } });
  await v1Request("factura/awb", { ...signed(cui, privateKey, number), Serie: series, Numar: String(number), AWB: String(awbNumber) }, { sandbox });
}
