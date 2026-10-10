// app/services/packeta.server.js
// Packeta (Zásilkovna) — docs in docs/api/packeta/README.md (https://docs.packeta.com).
//   • REST/XML  POST https://www.zasilkovna.cz/api/rest   — needs the 32-char API PASSWORD
//   • Feeds     https://pickup-point.api.packeta.com/v5/{API_KEY}/…  — need the 16-char API KEY
// Points and Z-BOXes are delivered by Packeta (Packeta label). Home delivery goes through a
// carrier chosen by `addressId` (RO: 4161 "best carrier") and prints the carrier's label.
import { normalizeRoPhone, parseRoStreet } from "../utils/address.js";

const REST_URL = "https://www.zasilkovna.cz/api/rest";
const FEED_BASE = "https://pickup-point.api.packeta.com/v5";

// Countries whose points Picklo keeps (same list as checkout-setup COURIER_COUNTRIES.packeta)
export const PACKETA_COUNTRIES = ["ro", "cz", "sk", "hu", "pl", "de", "at", "si", "hr", "bg"];
// Home-delivery carriers confirmed in the docs (RO "best carrier", CZ/SK Packeta Home).
// Other countries are resolved from the carrier feed (see resolveHomeCarrier).
export const HOME_CARRIERS = { RO: 4161, CZ: 106, SK: 131 };
const CURRENCY = { RO: "RON", CZ: "CZK", HU: "HUF", PL: "PLN", BG: "BGN" };

// One credential field used to hold either value: tell them apart by length.
export function packetaCredentials(s) {
  const raw = [s?.packetaApiKey, s?.packetaApiPassword].map((v) => String(v || "").trim()).filter(Boolean);
  return {
    apiKey: raw.find((v) => v.length === 16) || null,
    apiPassword: raw.find((v) => v.length === 32) || null,
  };
}

export const xmlEscape = (str) => String(str ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const decodeXml = (str) => String(str ?? "")
  .replace(/&lt;br\s*\/?&gt;|<br\s*\/?>/gi, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1]?.trim() ?? null;
const toXml = (obj) => Object.entries(obj)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => (typeof v === "object" ? `<${k}>${toXml(v)}</${k}>` : `<${k}>${xmlEscape(v)}</${k}>`)).join("");

export class PacketaError extends Error {}

// Known field faults, said in Romanian with what to do about them
function fieldHint(field, reason) {
  const r = decodeXml(reason);
  if (field === "cod" && /bank account/i.test(r)) return "contul Packeta nu are un cont bancar în moneda rambursului. Adaugă IBAN-ul în client.packeta.com (Contul meu) sau activează conversia valutară, apoi regenerează AWB-ul.";
  if (/^eshop/.test(field)) return "Packeta cere eticheta expeditorului. Completează „Expeditor” în Setări → Packeta exact ca în client.packeta.com → Expeditori.";
  if (field === "addressId" && /not valid|not exist|disabled/i.test(r)) return "punctul sau transportatorul ales nu mai e activ. Alege alt punct.";
  return r;
}

// REST call: <method><apiPassword/>…</method> → inner XML of <result>
async function rest(method, apiPassword, args = {}, { timeoutMs = 30000 } = {}) {
  if (!apiPassword) throw new PacketaError("Packeta: lipsește parola API (32 de caractere, din client.packeta.com → Suport).");
  const body = `<?xml version="1.0" encoding="utf-8"?><${method}><apiPassword>${xmlEscape(apiPassword)}</apiPassword>${toXml(args)}</${method}>`;
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const xml = await res.text();
  if (tag(xml, "status") !== "ok") {
    const fault = tag(xml, "fault") || "";
    // Field-level faults: <detail><attributes><fault><name>cod</name><fault>reason</fault></fault>…
    const fields = [...xml.matchAll(/<name>([^<]+)<\/name>\s*<fault>([^<]+)<\/fault>/gi)].map((m) => `${m[1]}: ${fieldHint(m[1], m[2])}`);
    const summary = tag(xml, "string");
    const msg = fields.length ? fields.join("; ") : summary || `HTTP ${res.status}`;
    throw new PacketaError(`Packeta${fault ? ` [${fault}]` : ""}: ${msg}`.slice(0, 500));
  }
  return tag(xml, "result") ?? "";
}

// ── Feeds ────────────────────────────────────────────────────────────────────
async function feed(apiKey, path, { country = null, attempts = 4 } = {}) {
  if (!apiKey) throw new PacketaError("Packeta: lipsește cheia API (16 caractere) pentru lista de puncte.");
  const url = `${FEED_BASE}/${encodeURIComponent(apiKey)}/${path}?lang=en${country ? `&country=${country.toUpperCase()}` : ""}`;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      // Brotli + per-country requests keep each download small (docs: feed optimization)
      const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Encoding": "br, gzip" }, signal: AbortSignal.timeout(60000) });
      if (res.status === 409) { last = new PacketaError("Packeta: feed-ul se generează, reîncerc"); await new Promise((r) => setTimeout(r, 5000 * (i + 1))); continue; }
      if (res.status === 401) throw new PacketaError("Packeta: cheia API nu e validă (401).");
      if (res.status === 400) return []; // country not enabled for this API key
      if (!res.ok) throw new PacketaError(`Packeta ${path} [${res.status}]`);
      const data = await res.json();
      return Array.isArray(data) ? data : data?.data || data?.carriers || [];
    } catch (e) {
      last = e;
      if (e instanceof PacketaError && !/reîncerc/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));  // network hiccup ("Premature close"): retry
    }
  }
  throw last;
}

const active = (b) => String(b.status?.statusId ?? 1) === "1" && String(b.displayFrontend ?? 1) !== "0";

export function pointToRow(b, type) {
  return {
    externalId: String(b.id),
    courier: "packeta",
    type,
    name: b.name || (type === "zbox" ? "Z-BOX" : "Packeta"),
    address: [b.street, b.city, b.zip].filter(Boolean).join(", "),
    city: b.city?.trim() || null,
    county: null,
    country: String(b.country || "").toLowerCase() || null,
    zip: b.zip || null,
    lat: Number.parseFloat(b.latitude) || null,
    lng: Number.parseFloat(b.longitude) || null,
  };
}

// Packeta points + Z-BOXes, country by country (the full feed is too big to download reliably).
export async function packetaGetPickupPoints({ apiKey, countries = PACKETA_COUNTRIES }) {
  const rows = [];
  const errors = [];
  for (const c of countries) {
    try {
      const [branches, boxes] = [await feed(apiKey, "branch/json", { country: c }), await feed(apiKey, "box/json", { country: c })];
      rows.push(...branches.filter(active).map((b) => pointToRow(b, "packeta_point")));
      // A box that can't take COD is still fine for prepaid orders: keep it, the AWB step checks COD
      rows.push(...boxes.filter(active).map((b) => pointToRow(b, "zbox")));
    } catch (e) {
      if (/cheia API/.test(e.message)) throw e;
      errors.push(`${c.toUpperCase()}: ${e.message}`);
    }
  }
  if (!rows.length && errors.length) throw new PacketaError(errors.join("; "));
  if (errors.length) console.warn("[Packeta] some countries failed:", errors.join("; "));
  return rows;
}

let carrierCache = { at: 0, list: [] };
export async function packetaGetCarriers({ apiKey }) {
  if (Date.now() - carrierCache.at < 6 * 3600e3 && carrierCache.list.length) return carrierCache.list;
  const list = (await feed(apiKey, "carrier/json")).map((c) => ({
    id: Number(c.id), name: c.name, country: String(c.country || "").toUpperCase(),
    available: String(c.available) === "true", pickupPoints: String(c.pickupPoints) === "true",
    apiAllowed: String(c.apiAllowed) === "true", disallowsCod: String(c.disallowsCod) === "true",
    requiresSize: String(c.requiresSize) === "true", separateHouseNumber: String(c.separateHouseNumber) === "true",
    maxWeight: Number(c.maxWeight) || null, currency: c.currency,
  }));
  carrierCache = { at: Date.now(), list };
  return list;
}

// ── Connection test ──────────────────────────────────────────────────────────
// Key → carrier feed. Password → packetAttributesValid with dummy data: a wrong password
// fails with IncorrectApiPasswordFault, a right one fails (or passes) on the attributes.
export async function packetaTestConnection({ apiKey, apiPassword }) {
  const out = { key: null, password: null };
  if (apiKey) out.key = (await packetaGetCarriers({ apiKey })).length > 0;
  if (apiPassword) {
    try {
      await rest("packetAttributesValid", apiPassword, { packetAttributes: { number: "picklo-test", name: "Test", surname: "Picklo", email: "test@picklo.app", addressId: HOME_CARRIERS.RO, value: 1, weight: 1, currency: "RON" } });
      out.password = true;
    } catch (e) {
      if (/IncorrectApiPassword|api password/i.test(e.message)) throw new PacketaError("Packeta: parola API e greșită.");
      out.password = true;
    }
  }
  if (!out.key && !out.password) throw new PacketaError("Packeta: completează cheia API (16 caractere) și parola API (32 de caractere).");
  if (!out.password) throw new PacketaError("Cheia API e bună, dar lipsește parola API (32 de caractere) — fără ea nu se pot genera AWB-uri.");
  if (!out.key) throw new PacketaError("Parola API e bună, dar lipsește cheia API (16 caractere) — fără ea nu se pot încărca punctele.");
  return true;
}

// ── Create packet ────────────────────────────────────────────────────────────
function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { name: parts[0] || "Client", surname: parts[0] || "Client" };
  return { name: parts.slice(0, -1).join(" ").slice(0, 32), surname: parts.at(-1).slice(0, 32) };
}

function intlPhone(phone, country) {
  if (country === "RO") { const ro = normalizeRoPhone(phone); if (ro) return `+40${ro.slice(1)}`; }
  const d = String(phone || "").replace(/[^\d+]/g, "");
  return d || undefined;
}

function roundCod(amount, currency) {
  if (currency === "CZK") return Math.round(amount);
  if (currency === "HUF") return Math.round(amount / 5) * 5;
  return Math.round(amount * 100) / 100;
}

export function buildPacketAttributes({ order, settings, pickupPointId, homeCarrierId }) {
  const country = String(order.shippingCountry || "RO").toUpperCase().slice(0, 2);
  const currency = CURRENCY[country] || "EUR";
  const { name, surname } = splitName(order.customerName);
  const cod = Number(order.codAmount) || 0;
  const attrs = {
    number: String(order.shopifyOrderName || order.shopifyOrderId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36) || `P${Date.now()}`,
    name, surname,
    email: order.customerEmail || undefined,
    phone: intlPhone(order.customerPhone, country),
    addressId: pickupPointId ? String(pickupPointId) : String(homeCarrierId || HOME_CARRIERS[country] || HOME_CARRIERS.RO),
    currency,
    cod: cod > 0 ? roundCod(cod, currency).toFixed(currency === "CZK" || currency === "HUF" ? 0 : 2) : undefined,
    value: Math.max(Number(order.orderTotal) || cod || 1, 1).toFixed(2),
    weight: Math.max(0.1, Number(order.weight) || 1).toFixed(3),
    eshop: settings?.packetaSender || undefined,
    note: order.notes ? String(order.notes).replace(/["";]/g, "").slice(0, 128) : undefined,
  };
  if (!pickupPointId) {
    const st = parseRoStreet(order.shippingAddress1 || "");
    attrs.street = (st.streetName ? `${st.streetType ? `${st.streetType} ` : ""}${st.streetName}` : order.shippingAddress1 || "").slice(0, 32);
    attrs.houseNumber = ([st.streetNo, st.blockNo && `bl. ${st.blockNo}`, st.entranceNo && `sc. ${st.entranceNo}`, st.apartmentNo && `ap. ${st.apartmentNo}`].filter(Boolean).join(" ") || "-").slice(0, 16);
    attrs.city = String(order.shippingCity || "").slice(0, 32);
    attrs.zip = String(order.shippingZip || "").replace(/\s/g, "");
    attrs.province = order.shippingCounty ? String(order.shippingCounty).slice(0, 32) : undefined;
  }
  return attrs;
}

// Merchant override → documented default → Packeta's own home delivery from the carrier feed
export async function resolveHomeCarrier({ apiKey, settings, country }) {
  const override = Number(settings?.packetaHomeCarrierId);
  if (override) return override;
  if (HOME_CARRIERS[country]) return HOME_CARRIERS[country];
  const list = apiKey ? await packetaGetCarriers({ apiKey }).catch(() => []) : [];
  const home = list.filter((c) => c.country === country && c.available && !c.pickupPoints);
  const pick = home.find((c) => /packeta home|home delivery/i.test(c.name)) || home.find((c) => /\bHD\b/.test(c.name)) || home[0];
  if (!pick) throw new PacketaError(`Packeta: nu am găsit un transportator pentru livrare acasă în ${country}. Setează ID-ul în Setări → Packeta.`);
  return pick.id;
}

export async function packetaCreatePacket({ apiKey, apiPassword, order, settings, pickupPointId = null }) {
  const country = String(order.shippingCountry || "RO").toUpperCase().slice(0, 2);
  const homeCarrierId = pickupPointId ? null : await resolveHomeCarrier({ apiKey, settings, country });
  const attrs = buildPacketAttributes({ order, settings, pickupPointId, homeCarrierId });
  if (!attrs.email && !attrs.phone) throw new PacketaError("Packeta: destinatarul are nevoie de email sau telefon.");

  // Home delivery: refuse early when the carrier can't carry COD or the parcel is too heavy
  if (!pickupPointId && apiKey) {
    const carrier = (await packetaGetCarriers({ apiKey }).catch(() => [])).find((c) => c.id === Number(attrs.addressId));
    if (carrier && attrs.cod && carrier.disallowsCod) throw new PacketaError(`Packeta: ${carrier.name} nu acceptă ramburs.`);
    if (carrier?.maxWeight && Number(attrs.weight) > carrier.maxWeight) throw new PacketaError(`Packeta: ${carrier.name} acceptă maximum ${carrier.maxWeight} kg.`);
  }

  const result = await rest("createPacket", apiPassword, { packetAttributes: attrs });
  const packetId = tag(result, "id");
  const barcode = tag(result, "barcode");
  if (!packetId) throw new PacketaError("Packeta: răspuns fără id de colet.");
  return {
    success: true,
    awbNumber: barcode || `Z${packetId}`,
    packetId: String(packetId),
    homeDelivery: !pickupPointId,
    carrierId: pickupPointId ? null : Number(attrs.addressId),
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────
const pdf = (b64) => Buffer.from(String(b64 || "").replace(/\s/g, ""), "base64");

export async function packetaDownloadLabel({ apiKey, apiPassword, packetId, format = "A6 on A4", homeDelivery = null }) {
  const id = String(packetId || "").replace(/^Z/i, "").replace(/\D/g, "");
  if (!id) throw new PacketaError("Packeta: lipsește id-ul coletului — regenerează AWB-ul.");

  // Home delivery: the last-mile carrier's own label when Packeta allows it (A6 only)
  if (homeDelivery !== false) {
    try {
      const info = await rest("packetCourierNumberV2", apiPassword, { packetId: id });
      const courierNumber = tag(info, "courierNumber");
      if (courierNumber) return pdf(await rest("packetCourierLabelPdf", apiPassword, { packetId: id, courierNumber }, { timeoutMs: 45000 }));
    } catch (e) {
      // Points/Z-BOX ("does not support generating courier numbers") or carrier without API labels → Packeta label
      if (homeDelivery === true && !/NotSupported|not support|courier number/i.test(e.message)) console.warn("[Packeta] carrier label unavailable:", e.message);
    }
  }
  return pdf(await rest("packetLabelPdf", apiPassword, { packetId: id, format, offset: 0 }));
}

// ── Tracking ─────────────────────────────────────────────────────────────────
// Status codes (docs → packet tracking) → Picklo statuses
const STATUS = {
  1: "generated", 2: "picked_up", 3: "in_transit", 4: "in_transit", 6: "in_transit", 12: "in_transit", 14: "in_transit", 15: "in_transit", 31: "in_transit", 28: "in_transit", 29: "in_transit", 30: "in_transit", 32: "in_transit",
  5: "out_for_delivery", 16: "out_for_delivery", 23: "out_for_delivery", 25: "out_for_delivery",
  7: "delivered",
  9: "returned", 10: "returned", 17: "returned", 18: "returned", 19: "returned", 20: "returned", 21: "returned", 22: "returned",
  24: "failed",
  11: "cancelled",
};
export const packetaStatus = (code) => STATUS[Number(code)] || null;

function records(xml, recordTag) {
  // Responses name each entry <record> (some older payloads use <statusRecord>)
  return [...xml.matchAll(new RegExp(`<(?:${recordTag}|statusRecord|externalStatusRecord)>([\\s\\S]*?)</(?:${recordTag}|statusRecord|externalStatusRecord)>`, "gi"))].map((m) => m[1]);
}

export async function packetaTrackPacket({ apiKey, apiPassword, packetId, awbNumber }) {
  const id = String(packetId || awbNumber || "").replace(/^Z/i, "").replace(/\D/g, "");
  const cred = apiPassword || apiKey; // tracking accepts the API key alone (docs)
  const xml = await rest("packetTracking", cred, { packetId: id });
  const events = records(xml, "record").map((r) => ({
    code: tag(r, "statusCode") || "",
    description: decodeXml(tag(r, "statusText") || tag(r, "codeText") || ""),
    date: new Date(tag(r, "dateTime")),
    location: null,
    status: packetaStatus(tag(r, "statusCode")),
  }));
  // Handed to an external carrier (6): add the carrier's own scans for detail
  if (events.some((e) => e.code === "6")) {
    try {
      const ext = await rest("packetCourierTracking", cred, { packetId: id });
      for (const r of records(ext, "record")) {
        events.push({ code: `ext:${tag(r, "statusCode") || ""}`, description: decodeXml(tag(r, "externalStatusName") || ""), date: new Date(tag(r, "dateTime")), location: tag(r, "carrierClass"), status: null });
      }
    } catch { /* carrier history is optional */ }
  }
  return events.filter((e) => !Number.isNaN(e.date.getTime()));
}

// ── Cancel ───────────────────────────────────────────────────────────────────
export async function packetaDeletePacket({ apiPassword, packetId }) {
  const id = String(packetId || "").replace(/^Z/i, "").replace(/\D/g, "");
  await rest("cancelPacket", apiPassword, { packetId: id });
  return { success: true };
}

// ── Returns: the customer drops the parcel at any Packeta point / Z-BOX with a password ──
export async function packetaCreateReturn({ apiPassword, settings, order, sendEmail = true }) {
  const country = String(order.shippingCountry || "RO").toUpperCase().slice(0, 2);
  const result = await rest("createPacketClaimWithPassword", apiPassword, {
    claimWithPasswordAttributes: {
      number: `RET${String(order.shopifyOrderName || "").replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 36),
      email: order.customerEmail || undefined,
      phone: intlPhone(order.customerPhone, country),
      value: Math.max(Number(order.orderTotal) || 1, 1).toFixed(2),
      currency: CURRENCY[country] || "EUR",
      eshop: settings?.packetaSender || "Picklo",
      consignCountry: country.toLowerCase(),
      sendEmailToCustomer: sendEmail && order.customerEmail ? "true" : "false",
    },
  });
  return { success: true, awbNumber: tag(result, "barcode") || `Z${tag(result, "id")}`, packetId: tag(result, "id"), password: tag(result, "password") };
}
