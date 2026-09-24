// app/services/oblio.server.js
// Oblio API integration — generates invoices (facturi) for Shopify orders.
// Docs: https://api.oblio.eu/docs/

const TOKEN_URL = "https://www.oblio.eu/api/authorize/token";
const BASE_URL  = "https://www.oblio.eu/api";

let _tokenCache = null;

async function getToken(email, secret) {
  if (_tokenCache && _tokenCache.email === email && _tokenCache.expiresAt > Date.now()) {
    return _tokenCache.token;
  }

  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ grant_type: "client_credentials", email, secret }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.message || `Oblio auth failed (${res.status})`);
  }

  _tokenCache = {
    email,
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

export async function oblioTestConnection({ email, secret, cif }) {
  const token = await getToken(email, secret);
  const res = await fetch(`${BASE_URL}/docs/nomenclature/companies`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Oblio connection test failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const companies = data?.data || [];
  const match = companies.find((c) => c.cif === cif || c.cif === cif?.replace(/^RO/i, ""));
  if (!match && companies.length > 0) {
    throw new Error(`CIF "${cif}" nu a fost găsit în contul Oblio. CIF-uri disponibile: ${companies.map((c) => c.cif).join(", ")}`);
  }
  return true;
}

export async function oblioCreateInvoice({ email, secret, cif, series, tva, currency, order }) {
  const token      = await getToken(email, secret);
  const vatPercent = parseFloat(tva) || 19;

  const products = (order.lineItems || []).map((item) => ({
    name:        item.name || item.title || "Produs",
    code:        item.sku  || "",
    measuringUnit: "buc",
    currency:    currency || "RON",
    quantity:    item.quantity || 1,
    price:       parseFloat(item.price) || 0,
    vatIncluded: true,
    vatPercentage: vatPercent,
    vatName:     vatPercent === 0 ? "Scutit" : "Normala",
  }));

  if ((order.shippingTotal || 0) > 0) {
    products.push({
      name:          "Transport",
      measuringUnit: "buc",
      currency:      currency || "RON",
      quantity:      1,
      price:         parseFloat(order.shippingTotal),
      vatIncluded:   true,
      vatPercentage: vatPercent,
      vatName:       "Normala",
    });
  }

  const body = {
    cif,
    seriesName: series,
    client: {
      name:    order.customerName  || "Client",
      cif:     "",
      address: order.shippingAddress1 || "",
      city:    order.shippingCity   || "",
      county:  order.shippingCounty || "",
      country: order.shippingCountry || "Romania",
      email:   order.customerEmail || "",
      phone:   order.customerPhone || "",
      vatPayer: false,
      save:    false,
    },
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate:   new Date().toISOString().slice(0, 10),
    deliveryDate: new Date().toISOString().slice(0, 10),
    currency:  currency || "RON",
    language:  "RO",
    precision: 2,
    products,
    observations: `Comanda Shopify ${order.shopifyOrderName || ""}`,
    useStock: false,
  };

  const res = await fetch(`${BASE_URL}/docs/invoice`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.status !== "ok") {
    throw new Error(data.statusMessage || data.message || `Oblio error ${res.status}`);
  }

  return { invoiceNumber: data.data?.number, series: data.data?.seriesName };
}

export async function oblioGetInvoicePdf({ email, secret, cif, series, number }) {
  const token = await getToken(email, secret);
  const url   = `${BASE_URL}/docs/invoice/${encodeURIComponent(cif)}/${encodeURIComponent(series)}/${encodeURIComponent(number)}?format=pdf`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Oblio PDF fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}
