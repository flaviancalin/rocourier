// app/services/smartbill.server.js
// SmartBill Cloud API — invoices for Shopify orders.
// Spec: https://api.smartbill.ro (OpenAPI 3.1, base https://ws.smartbill.ro/SBORO/api)
// Auth: HTTP Basic email:token. Errors come back as { errorText } (also on some 200s).

const BASE_URL = "https://ws.smartbill.ro/SBORO/api";

function headers(email, token) {
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function request(path, { method = "GET", email, token, body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    method,
    headers: headers(email, token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { errorText: text.slice(0, 300) }; }
  if (!res.ok || data.errorText) {
    throw new Error(`SmartBill ${method} ${path} (${res.status}): ${data.errorText || data.message || "eroare necunoscuta"}`);
  }
  return data;
}

export async function smartbillTestConnection({ email, token, cif }) {
  const data = await request("/series", { email, token, query: { cif, type: "f" } });
  return { series: (data.list || []).map((s) => s.name) };
}

// order: normalized order from invoice.server.js (net prices after discounts)
export async function smartbillCreateInvoice({ email, token, cif, series, tva, currency, order }) {
  const vatPercent = Number.parseFloat(tva);
  const vat = Number.isFinite(vatPercent) ? vatPercent : 21;
  const line = (name, code, quantity, price) => ({
    name, code: code || "", measuringUnitName: "buc", currency: currency || "RON",
    quantity, price, isTaxIncluded: true, taxPercentage: vat, // SmartBill matches the rate configured in the account
    saveToDb: false,
  });

  const products = order.lineItems.map((i) => line(i.name, i.sku, i.quantity, i.unitPrice));
  if (order.shippingTotal > 0) products.push({ ...line("Transport", "", 1, order.shippingTotal), isService: true });

  const today = new Date().toISOString().slice(0, 10);
  const data = await request("/invoice/v2", {
    method: "POST", email, token,
    body: {
      companyVatCode: cif,
      seriesName: series,
      issueDate: today,
      dueDate: today,
      client: {
        name: order.customerName || "Client",
        isTaxPayer: false,
        address: order.shippingAddress1 || "",
        city: order.shippingCity || "",
        county: order.shippingCounty || "",
        country: order.shippingCountry || "Romania",
        email: order.customerEmail || "",
        phone: order.customerPhone || "",
        saveToDb: false,
      },
      currency: currency || "RON",
      language: "RO",
      precision: 2,
      products,
      mentions: `Comanda Shopify ${order.shopifyOrderName || ""}`.trim(),
    },
  });
  return { series: data.series || series, number: String(data.number), url: data.documentViewUrl || data.documentUrl || null };
}

// Storno: a new negative invoice referencing the original
export async function smartbillReverseInvoice({ email, token, cif, series, number }) {
  const data = await request("/invoice/reverse", {
    method: "POST", email, token,
    body: { companyVatCode: cif, seriesName: series, number: String(number) },
  });
  return { series: data.series || series, number: String(data.number) };
}

export async function smartbillCancelInvoice({ email, token, cif, series, number }) {
  await request("/invoice/cancel", { method: "PUT", email, token, query: { cif, seriesname: series, number } });
}

// Only the last invoice in a series can be deleted; use cancel otherwise
export async function smartbillDeleteInvoice({ email, token, cif, series, number }) {
  await request("/invoice", { method: "DELETE", email, token, query: { cif, seriesname: series, number } });
}

export async function smartbillInvoicePaymentStatus({ email, token, cif, series, number }) {
  return request("/invoice/paymentstatus", { email, token, query: { cif, seriesname: series, number } });
}

// Records the cash-on-delivery money collected by the courier ("Ramburs") against the invoice
export async function smartbillCollectInvoice({ email, token, cif, series, number, type = "Ramburs" }) {
  await request("/payment", {
    method: "POST", email, token,
    body: {
      companyVatCode: cif,
      issueDate: new Date().toISOString().slice(0, 10),
      type,
      useInvoiceDetails: true,
      invoicesList: [{ seriesName: series, number: String(number) }],
    },
  });
}

export async function smartbillGetInvoicePdf({ email, token, cif, series, number }) {
  const url = `${BASE_URL}/invoice/pdf?${new URLSearchParams({ cif, seriesname: series, number })}`;
  const res = await fetch(url, { headers: { ...headers(email, token), Accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`SmartBill PDF (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
