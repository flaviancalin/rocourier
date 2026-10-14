// app/services/accounting-export.server.js — monthly files for the accountant:
//   • vanzari.csv      sales journal (invoice, client, VAT, payment, courier, COD, profit)
//   • ramburs.csv      COD per AWB: amount, collected, payout reference, difference
//   • transport.csv    courier cost per AWB (to match the courier's invoices)
//   • SAGA I_<data>.xml   COD receipts for Saga C (Diverse → Import date), linked to invoices
//   • SAGA F_<cif>.xml    outgoing invoices for Saga C, for stores whose invoicing app doesn't export to SAGA
// CSVs are UTF-8 with BOM and ";" separators so Excel in Romanian opens them correctly.
import { prisma } from "../db.server.js";
import { computeProfit, storeVatRate } from "./profit.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

const BOM = "﻿";
const roDate = (d) => (d ? new Date(d).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const num = (n) => (n == null || n === "" ? "" : (Math.round(Number(n) * 100) / 100).toFixed(2).replace(".", ","));
const cell = (v) => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head, rows) => BOM + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
const x = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const courierName = (c) => COURIER_LABELS[c]?.name || c || "";
const invoiceNo = (o) => [o.invoiceSeries, o.invoiceNumber].filter(Boolean).join("");

export function monthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear(), mo = m ? Number(m[2]) - 1 : now.getMonth();
  return { from: new Date(Date.UTC(y, mo, 1, -2)), to: new Date(Date.UTC(y, mo + 1, 1, -2)), label: `${y}-${String(mo + 1).padStart(2, "0")}` };
}

const ordersIn = (shop, { from, to }) => prisma.order.findMany({
  where: { shop, shopifyCreatedAt: { gte: from, lt: to } }, orderBy: { shopifyCreatedAt: "asc" }, take: 20000,
});

export async function salesCsv(shop, range) {
  const [orders, settings] = await Promise.all([ordersIn(shop, range), prisma.shopSettings.findUnique({ where: { shop } })]);
  const vat = storeVatRate(settings);
  const rows = orders.map((o) => {
    const p = computeProfit(o, settings);
    const tax = o.taxAmount != null ? o.taxAmount : vat > 0 ? o.orderTotal - o.orderTotal / (1 + vat / 100) : 0;
    return [
      roDate(o.shopifyCreatedAt), o.shopifyOrderName, invoiceNo(o), roDate(o.invoiceIssuedAt), o.invoiceStatus || "",
      o.customerName, o.customerCompany || "", o.customerVatCode || "", o.shippingCity, o.shippingCounty,
      num(o.orderTotal), num(tax), num(o.orderTotal - tax), o.codAmount > 0 ? "Ramburs" : "Card / online", o.financialStatus || "",
      o.shopifyCancelledAt ? "anulată" : "", courierName(o.courierType), o.shippingMethod === "pickup_point" ? "Locker / punct" : "Acasă",
      o.awbNumber || "", o.awbStatus, num(o.codAmount), num(o.codCollectedAmount), roDate(o.codCollectedAt),
      num(o.shippingCost), num(o.cogsAmount), num(p.profit),
    ];
  });
  return csv(["Data", "Comanda", "Factura", "Data factura", "Status factura", "Client", "Firma", "CUI", "Localitate", "Judet",
    "Total", "TVA", "Total fara TVA", "Plata", "Status plata", "Anulata", "Curier", "Livrare", "AWB", "Status livrare",
    "Ramburs", "Ramburs incasat", "Data incasare", "Cost transport", "Cost produse", "Profit"], rows);
}

export async function codCsv(shop, range) {
  const orders = (await ordersIn(shop, range)).filter((o) => o.codAmount > 0 && o.awbNumber);
  return csv(["AWB", "Curier", "Comanda", "Factura", "Client", "Ramburs", "Incasat", "Data incasare", "Referinta borderou", "Diferenta", "Status livrare"],
    orders.map((o) => [o.awbNumber, courierName(o.courierType), o.shopifyOrderName, invoiceNo(o), o.customerName, num(o.codAmount),
      num(o.codCollectedAmount), roDate(o.codCollectedAt), o.codPayoutRef || "",
      o.codCollectedAmount != null ? num(o.codCollectedAmount - o.codAmount) : "", o.awbStatus]));
}

export async function shippingCsv(shop, range) {
  const orders = (await ordersIn(shop, range)).filter((o) => o.awbNumber);
  return csv(["AWB", "Curier", "Comanda", "Data comenzii", "Livrare", "Greutate (kg)", "Colete", "Ramburs", "Cost transport (cu TVA)", "Status"],
    orders.map((o) => [o.awbNumber, courierName(o.courierType), o.shopifyOrderName, roDate(o.shopifyCreatedAt),
      o.shippingMethod === "pickup_point" ? "Locker / punct" : "Acasă", num(o.weight), o.packageCount || 1, num(o.codAmount), num(o.shippingCost), o.awbStatus]));
}

// SAGA receipts: one line per COD collected in the month (Registru de casă / Jurnal de bancă)
export async function sagaReceiptsXml(shop, range) {
  const [orders, settings] = await Promise.all([
    prisma.order.findMany({ where: { shop, codCollectedAt: { gte: range.from, lt: range.to } }, orderBy: { codCollectedAt: "asc" } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);
  const account = settings?.sagaCodAccount || "5311";
  const lines = orders.map((o) => `  <Linie>
    <Data>${x(roDate(o.codCollectedAt))}</Data>
    <Numar>${x(o.codPayoutRef || o.awbNumber || o.shopifyOrderName)}</Numar>
    <Suma>${x((o.codCollectedAmount ?? o.codAmount).toFixed(2))}</Suma>
    <Cont>${x(account)}</Cont>
    <Explicatie>${x(`Ramburs ${courierName(o.courierType)} AWB ${o.awbNumber || ""} comanda ${o.shopifyOrderName}`)}</Explicatie>
    ${invoiceNo(o) ? `<FacturaNumar>${x(invoiceNo(o))}</FacturaNumar>` : ""}
    ${o.customerVatCode ? `<CodFiscal>${x(o.customerVatCode)}</CodFiscal>` : ""}
  </Linie>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Incasari>\n${lines.join("\n")}\n</Incasari>\n`;
}

export function companyCif(settings) {
  return String(settings?.smartbillCompanyCIF || settings?.oblioCIF || settings?.fgoCui || "").replace(/^RO/i, "").trim();
}

// SAGA outgoing invoices (Ieșiri): invoiced orders, lines from Shopify (net price, VAT %)
export async function sagaInvoicesXml(admin, shop, range) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const vat = storeVatRate(settings);
  const cif = companyCif(settings);
  const orders = (await ordersIn(shop, range)).filter((o) => o.invoiceNumber && o.invoiceStatus !== "cancelled");
  const linesByOrder = {};
  for (let i = 0; i < orders.length; i += 25) {
    const chunk = orders.slice(i, i + 25);
    try {
      const res = await admin.graphql(`query ($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id
        lineItems(first: 100) { nodes { name sku currentQuantity discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } } }
        shippingLines(first: 5) { nodes { title discountedPriceSet { shopMoney { amount } } } } } } }`,
        { variables: { ids: chunk.map((o) => `gid://shopify/Order/${o.shopifyOrderId}`) } });
      for (const n of (await res.json()).data?.nodes || []) if (n?.id) linesByOrder[n.id.split("/").pop()] = n;
    } catch (e) { console.error("[saga] lines:", e.message || e); }
  }
  const net = (gross) => (vat > 0 ? gross / (1 + vat / 100) : gross);
  const invoices = orders.map((o) => {
    const n = linesByOrder[o.shopifyOrderId];
    const items = (n?.lineItems?.nodes || []).filter((l) => l.currentQuantity > 0).map((l) => ({
      name: l.name, code: l.sku, qty: l.currentQuantity, gross: Number(l.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount) || 0,
    }));
    for (const s of n?.shippingLines?.nodes || []) {
      const g = Number(s.discountedPriceSet?.shopMoney?.amount) || 0;
      if (g > 0) items.push({ name: `Transport ${s.title || ""}`.trim(), code: "TRANSPORT", qty: 1, gross: g });
    }
    if (!items.length) items.push({ name: `Comanda ${o.shopifyOrderName}`, code: "", qty: 1, gross: o.orderTotal });
    const rows = items.map((it, i) => {
      const unit = net(it.gross), value = unit * it.qty, tax = it.gross * it.qty - value;
      return `        <Linie>
          <LinieNrCrt>${i + 1}</LinieNrCrt>
          <Descriere>${x(it.name)}</Descriere>
          ${it.code ? `<CodArticolFurnizor>${x(it.code)}</CodArticolFurnizor>` : ""}
          <UM>buc</UM>
          <Cantitate>${it.qty}</Cantitate>
          <Pret>${unit.toFixed(4)}</Pret>
          <Valoare>${value.toFixed(2)}</Valoare>
          <ProcTVA>${vat}</ProcTVA>
          <TVA>${tax.toFixed(2)}</TVA>
        </Linie>`;
    }).join("\n");
    return `  <Factura>
    <Antet>
      <FurnizorNume>${x(settings?.senderName || "")}</FurnizorNume>
      <FurnizorCIF>${x(cif)}</FurnizorCIF>
      <ClientNume>${x(o.customerCompany || o.customerName)}</ClientNume>
      <ClientCIF>${x(o.customerVatCode || "")}</ClientCIF>
      <ClientTara>${x(o.shippingCountry || "RO")}</ClientTara>
      <ClientJudet>${x(o.shippingCounty || "")}</ClientJudet>
      <ClientLocalitate>${x(o.shippingCity || "")}</ClientLocalitate>
      <ClientAdresa>${x(o.shippingAddress1 || "")}</ClientAdresa>
      <ClientTelefon>${x(o.customerPhone || "")}</ClientTelefon>
      <ClientMail>${x(o.customerEmail || "")}</ClientMail>
      <FacturaNumar>${x(invoiceNo(o))}</FacturaNumar>
      <FacturaData>${x(roDate(o.invoiceIssuedAt || o.shopifyCreatedAt))}</FacturaData>
      <FacturaScadenta>${x(roDate(o.invoiceIssuedAt || o.shopifyCreatedAt))}</FacturaScadenta>
      <FacturaTaxareInversa>Nu</FacturaTaxareInversa>
      <FacturaTVAIncasare>Nu</FacturaTVAIncasare>
      <FacturaInformatiiSuplimentare>${x(`Comanda ${o.shopifyOrderName}${o.awbNumber ? `, AWB ${o.awbNumber}` : ""}`)}</FacturaInformatiiSuplimentare>
    </Antet>
    <Detalii>
      <Continut>
${rows}
      </Continut>
    </Detalii>
  </Factura>`;
  });
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<Facturi>\n${invoices.join("\n")}\n</Facturi>\n`, cif, count: invoices.length };
}
