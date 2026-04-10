// app/routes/api.packing-slip.js
// Generates a printable packing slip HTML page for one or multiple orders
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const COURIER_LABELS = {
  fan:     "FAN Courier",
  sameday: "Sameday",
  cargus:  "Cargus",
  gls:     "GLS Romania",
  packeta: "Packeta",
};

function escape(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("ro-RO", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function slipHtml(order, lineItems, settings) {
  const courier = COURIER_LABELS[order.courierType] || order.courierType;
  const delivery = order.shippingMethod === "pickup_point"
    ? `Punct ridicare: ${escape(order.pickupPointName || "")} — ${escape(order.pickupPointAddress || "")}`
    : `Acasă: ${escape(order.shippingAddress1 || "")}, ${escape(order.shippingCity || "")}, ${escape(order.shippingCounty || "")} ${escape(order.shippingZip || "")}`;

  const itemRows = lineItems.map((li) => `
    <tr>
      <td>${escape(li.name)}</td>
      <td style="text-align:center">${escape(li.variant_title || "—")}</td>
      <td style="text-align:center">${escape(li.sku || "—")}</td>
      <td style="text-align:center">${li.quantity}</td>
      <td style="text-align:right">${parseFloat(li.price).toFixed(2)} RON</td>
      <td style="text-align:right">${(parseFloat(li.price) * li.quantity).toFixed(2)} RON</td>
    </tr>
  `).join("");

  return `
<div class="slip" style="page-break-after:always">
  <div class="header">
    <div>
      <div class="company">${escape(settings?.senderName || "Magazin")}</div>
      <div class="sub">${escape(settings?.senderAddress || "")} ${escape(settings?.senderCity || "")}</div>
      <div class="sub">${escape(settings?.senderEmail || "")} · ${escape(settings?.senderPhone || "")}</div>
    </div>
    <div style="text-align:right">
      <div class="order-num">${escape(order.shopifyOrderName)}</div>
      <div class="sub">Data: ${formatDate(order.shopifyCreatedAt || order.createdAt)}</div>
      ${order.awbNumber ? `<div class="sub">AWB: <strong>${escape(order.awbNumber)}</strong> (${escape(courier)})</div>` : ""}
    </div>
  </div>

  <div class="section-title">Destinatar</div>
  <div class="customer">
    <strong>${escape(order.customerName || "")}</strong><br>
    ${escape(order.customerPhone || "")} · ${escape(order.customerEmail || "")}<br>
    ${delivery}
  </div>

  <div class="section-title">Produse</div>
  <table>
    <thead>
      <tr>
        <th style="text-align:left">Produs</th>
        <th style="text-align:center">Variantă</th>
        <th style="text-align:center">SKU</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">Preț/buc</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right;font-weight:700;border-top:2px solid #333">Total comandă</td>
        <td style="text-align:right;font-weight:700;border-top:2px solid #333">${order.orderTotal?.toFixed(2)} RON</td>
      </tr>
      ${order.codAmount > 0 ? `
      <tr>
        <td colspan="5" style="text-align:right;color:#c0392b">Ramburs (COD)</td>
        <td style="text-align:right;color:#c0392b;font-weight:700">${order.codAmount?.toFixed(2)} RON</td>
      </tr>` : ""}
    </tfoot>
  </table>
</div>`;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const url = new URL(request.url);
  const orderIds = url.searchParams.get("orderIds")?.split(",").filter(Boolean);
  if (!orderIds?.length) return new Response("Missing orderIds", { status: 400 });

  const [orders, settings] = await Promise.all([
    prisma.order.findMany({ where: { shop, id: { in: orderIds } } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!orders.length) return new Response("No orders found", { status: 404 });

  // Fetch Shopify line items for each order
  const token = (await prisma.session.findFirst({ where: { shop } }))?.accessToken;
  const lineItemsByOrder = {};

  if (token) {
    await Promise.all(
      orders.map(async (order) => {
        try {
          const res = await fetch(
            `https://${shop}/admin/api/2024-10/orders/${order.shopifyOrderId}.json?fields=id,line_items`,
            { headers: { "X-Shopify-Access-Token": token } }
          );
          if (res.ok) {
            const { order: o } = await res.json();
            lineItemsByOrder[order.id] = o?.line_items || [];
          }
        } catch (_) {}
        if (!lineItemsByOrder[order.id]) lineItemsByOrder[order.id] = [];
      })
    );
  }

  const slips = orders
    .map((o) => slipHtml(o, lineItemsByOrder[o.id] || [], settings))
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <title>Bon de livrare — ${orders.map((o) => o.shopifyOrderName).join(", ")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #222; background: #fff; }
    .slip { padding: 24px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
    .company { font-size: 18px; font-weight: 700; }
    .order-num { font-size: 20px; font-weight: 700; color: #1a1a1a; }
    .sub { color: #555; font-size: 11px; margin-top: 3px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin: 14px 0 6px; }
    .customer { background: #f8f8f8; padding: 10px 14px; border-radius: 4px; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { background: #f0f0f0; padding: 7px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #ccc; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tfoot td { padding: 8px 10px; background: #fafafa; }
    @media print {
      body { font-size: 11px; }
      .slip { padding: 12px; }
      @page { margin: 10mm; }
    }
  </style>
</head>
<body>
  ${slips}
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => window.print(), 300);
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
