// app/services/smartbill.server.js
// SmartBill API integration — generates invoices (facturi) for Shopify orders.
// Docs: https://api.smartbill.ro/smartbill-integration/docs

const BASE_URL = "https://ws.smartbill.ro/SBORO/api";

function authHeader(email, token) {
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

export async function smartbillTestConnection({ email, token, cif }) {
  const res = await fetch(`${BASE_URL}/company/allfiscalseriesbytype?cif=${encodeURIComponent(cif)}&type=f`, {
    headers: authHeader(email, token),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SmartBill auth failed (${res.status}): ${body}`);
  }
  return true;
}

export async function smartbillCreateInvoice({ email, token, cif, series, tva, currency, order }) {
  const vatPercent = parseFloat(tva) || 19;
  const vatRate    = vatPercent / 100;

  const products = (order.lineItems || []).map((item) => ({
    name:       item.name || item.title || "Produs",
    code:       item.sku  || "",
    measuringUnitName: "buc",
    currency:   currency || "RON",
    quantity:   item.quantity || 1,
    price:      parseFloat(item.price) || 0,
    isTaxIncluded: true,
    taxName:    vatPercent === 0 ? "Scutit" : "TVA",
    taxPercentage: vatPercent,
  }));

  if ((order.shippingTotal || 0) > 0) {
    products.push({
      name: "Transport",
      measuringUnitName: "buc",
      currency: currency || "RON",
      quantity: 1,
      price: parseFloat(order.shippingTotal),
      isTaxIncluded: true,
      taxName: "TVA",
      taxPercentage: vatPercent,
    });
  }

  const body = {
    companyVatCode: cif,
    seriesName:     series,
    client: {
      name:    order.customerName  || "Client",
      email:   order.customerEmail || "",
      address: order.shippingAddress1 || "",
      city:    order.shippingCity   || "",
      county:  order.shippingCounty || "",
      country: order.shippingCountry || "Romania",
      phone:   order.customerPhone || "",
      isTaxPayer: false,
      saveToDb: false,
    },
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate:   new Date().toISOString().slice(0, 10),
    currency:  currency || "RON",
    language:  "RO",
    precision: 2,
    products,
    mentions: `Comanda Shopify ${order.shopifyOrderName || ""}`,
  };

  const res = await fetch(`${BASE_URL}/invoice`, {
    method:  "POST",
    headers: authHeader(email, token),
    body:    JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.errorText) {
    throw new Error(data.errorText || data.message || `SmartBill error ${res.status}`);
  }

  return { invoiceNumber: data.number, series: data.series };
}

export async function smartbillGetInvoicePdf({ email, token, cif, series, number }) {
  const url = `${BASE_URL}/invoice/pdf?cif=${encodeURIComponent(cif)}&seriesname=${encodeURIComponent(series)}&number=${encodeURIComponent(number)}`;
  const res = await fetch(url, { headers: authHeader(email, token) });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}
