// app/services/oblio.server.js
// Oblio API — invoices for Shopify orders.
// Docs: https://www.oblio.eu/api · reference client: github.com/OblioSoftware/OblioApiJs
// Auth: POST /api/authorize/token { client_id: email, client_secret } → Bearer token (1h).
// Responses: { status: 200, statusMessage, data }.

const BASE_URL = "https://www.oblio.eu/api";
const tokenCache = new Map(); // email → { token, expiresAt }

async function getToken(email, secret) {
  const cached = tokenCache.get(email);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${BASE_URL}/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: email, client_secret: secret, grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Oblio autentificare esuata (${res.status}): ${data.error_description || data.statusMessage || data.message || "verifica emailul si cheia API"}`);
  }
  tokenCache.set(email, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 });
  return data.access_token;
}

async function request(path, { method = "GET", email, secret, body, query } = {}) {
  const token = await getToken(email, secret);
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.status && Number(data.status) >= 300)) {
    throw new Error(`Oblio ${method} ${path} (${res.status}): ${data.statusMessage || "eroare necunoscuta"}`);
  }
  return data;
}

const stripRo = (cif) => String(cif || "").replace(/^RO/i, "").trim();

export async function oblioTestConnection({ email, secret, cif }) {
  const data = await request("/nomenclature/companies", { email, secret });
  const companies = data.data || [];
  const match = companies.find((c) => stripRo(c.cif) === stripRo(cif));
  if (!match) {
    throw new Error(`CIF "${cif}" nu a fost gasit in contul Oblio. CIF-uri disponibile: ${companies.map((c) => c.cif).join(", ") || "niciunul"}`);
  }
  const series = await request("/nomenclature/series", { email, secret, query: { cif } }).catch(() => ({ data: [] }));
  return { series: (series.data || []).filter((s) => s.type === "Factura").map((s) => s.name) };
}

// order: normalized order from invoice.server.js (net prices after discounts)
export async function oblioCreateInvoice({ email, secret, cif, series, tva, currency, order }) {
  const vatPercent = Number.parseFloat(tva);
  const vat = Number.isFinite(vatPercent) ? vatPercent : 21;
  const line = (name, code, quantity, price, productType = "Marfa") => ({
    name, code: code || "", measuringUnit: "buc", currency: currency || "RON",
    quantity, price, vatIncluded: 1, vatPercentage: vat, productType, save: 0,
  });

  const products = order.lineItems.map((i) => line(i.name, i.sku, i.quantity, i.unitPrice));
  if (order.shippingTotal > 0) products.push(line("Transport", "", 1, order.shippingTotal, "Serviciu"));

  const today = new Date().toISOString().slice(0, 10);
  const data = await request("/docs/invoice", {
    method: "POST", email, secret,
    body: {
      cif,
      seriesName: series,
      issueDate: today,
      dueDate: today,
      deliveryDate: today,
      client: {
        name: order.customerName || "Client",
        address: order.shippingAddress1 || "",
        city: order.shippingCity || "",
        state: order.shippingCounty || "",
        country: order.shippingCountry || "Romania",
        email: order.customerEmail || "",
        phone: order.customerPhone || "",
        vatPayer: 0,
        save: 0,
      },
      currency: currency || "RON",
      language: "RO",
      precision: 2,
      useStock: 0,
      products,
      mentions: `Comanda Shopify ${order.shopifyOrderName || ""}`.trim(),
      orderNumber: order.shopifyOrderName || "",
      idempotencyKey: order.idempotencyKey || undefined,
    },
  });
  return { series: data.data?.seriesName || series, number: String(data.data?.number), url: data.data?.link || null };
}

// Storno (credit note): new invoice referencing the original with refund=1
export async function oblioReverseInvoice({ email, secret, cif, series, number }) {
  const data = await request("/docs/invoice", {
    method: "POST", email, secret,
    body: { cif, seriesName: series, referenceDocument: { type: "Factura", seriesName: series, number: Number(number), refund: 1 } },
  });
  return { series: data.data?.seriesName || series, number: String(data.data?.number) };
}

export async function oblioCancelInvoice({ email, secret, cif, series, number }) {
  await request("/docs/invoice/cancel", { method: "PUT", email, secret, body: { cif, seriesName: series, number: Number(number) } });
}

// Only the last invoice in a series can be deleted; use cancel otherwise
export async function oblioDeleteInvoice({ email, secret, cif, series, number }) {
  await request("/docs/invoice", { method: "DELETE", email, secret, body: { cif, seriesName: series, number: Number(number) } });
}

// Records the cash-on-delivery money collected by the courier ("Ramburs"); the AWB is the payment document
export async function oblioCollectInvoice({ email, secret, cif, series, number, documentNumber }) {
  await request("/docs/invoice/collect", {
    method: "PUT", email, secret,
    body: { cif, seriesName: series, number: Number(number), collect: { type: "Ramburs", documentNumber: documentNumber || `Ramburs ${series}${number}` } },
  });
}

export async function oblioGetInvoice({ email, secret, cif, series, number }) {
  const data = await request("/docs/invoice", { email, secret, query: { cif, seriesName: series, number } });
  return data.data;
}

export async function oblioGetInvoicePdf({ email, secret, cif, series, number }) {
  const doc = await oblioGetInvoice({ email, secret, cif, series, number });
  if (!doc?.link) throw new Error("Oblio: factura nu are link PDF");
  const res = await fetch(doc.link);
  if (!res.ok) throw new Error(`Oblio PDF (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
