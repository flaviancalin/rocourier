// app/services/invoice.server.js
// Routes invoice actions to the configured provider (SmartBill / Oblio) and keeps
// the invoice reference on the order so it can be cancelled, reversed or collected.

import {
  smartbillCreateInvoice, smartbillReverseInvoice, smartbillCancelInvoice, smartbillCollectInvoice,
} from "./smartbill.server.js";
import {
  oblioCreateInvoice, oblioReverseInvoice, oblioCancelInvoice, oblioCollectInvoice,
} from "./oblio.server.js";
import {
  fgoCreateInvoice, fgoReverseInvoice, fgoCancelInvoice, fgoCollectInvoice, fgoAttachAwb,
} from "./fgo.server.js";
import { prisma } from "../db.server.js";
import { logActivity } from "./activity.server.js";
import { enrichCompany } from "./anaf.server.js";

// Provider → functions. Each takes the provider creds plus { series, number } / { order }.
const PROVIDERS = {
  smartbill: { create: smartbillCreateInvoice, reverse: smartbillReverseInvoice, cancel: smartbillCancelInvoice, collect: smartbillCollectInvoice },
  oblio:     { create: oblioCreateInvoice,     reverse: oblioReverseInvoice,     cancel: oblioCancelInvoice,     collect: oblioCollectInvoice },
  fgo:       { create: fgoCreateInvoice,       reverse: fgoReverseInvoice,       cancel: fgoCancelInvoice,       collect: fgoCollectInvoice },
};

const round2 = (n) => Math.round(n * 100) / 100;

// Credentials + document settings of the active provider, or null when invoicing is off
export function invoiceProviderConfig(settings) {
  if (settings?.invoiceProvider === "smartbill" && settings.smartbillEnabled && settings.smartbillEmail && settings.smartbillToken) {
    return {
      provider: "smartbill",
      creds: { email: settings.smartbillEmail, token: settings.smartbillToken, cif: settings.smartbillCompanyCIF },
      series: settings.smartbillSeries, tva: settings.smartbillTVA || "21", currency: settings.smartbillCurrency || "RON",
    };
  }
  if (settings?.invoiceProvider === "oblio" && settings.oblioEnabled && settings.oblioEmail && settings.oblioSecret) {
    return {
      provider: "oblio",
      creds: { email: settings.oblioEmail, secret: settings.oblioSecret, cif: settings.oblioCIF },
      series: settings.oblioSeries, tva: settings.oblioTVA || "21", currency: settings.oblioCurrency || "RON",
    };
  }
  if (settings?.invoiceProvider === "fgo" && settings.fgoEnabled && settings.fgoCui && settings.fgoPrivateKey) {
    return {
      provider: "fgo",
      // Fgo-Url-Platforma: the store address the merchant registered in FGO → Setări eCommerce → API
      creds: { cui: String(settings.fgoCui).replace(/^RO/i, "").trim(), privateKey: settings.fgoPrivateKey, sandbox: !!settings.fgoSandbox,
        platformUrl: `https://${settings.shop}` },
      series: settings.fgoSeries, tva: settings.fgoTVA || "21", currency: settings.fgoCurrency || "RON",
    };
  }
  return null;
}

// Shopify webhook (REST-shaped) order → invoice lines at the price actually paid
export function normalizeWebhookOrder(payload) {
  const shipping = payload.shipping_address || payload.billing_address || {};
  const lineItems = (payload.line_items || [])
    .map((item) => {
      const quantity = item.current_quantity ?? item.quantity ?? 1;
      const discount = (item.discount_allocations || []).reduce((s, d) => s + (Number.parseFloat(d.amount) || 0), 0);
      const gross = (Number.parseFloat(item.price) || 0) * (item.quantity || 1);
      return { name: item.name || item.title || "Produs", sku: item.sku || "", quantity, unitPrice: round2((gross - discount) / (item.quantity || 1)) };
    })
    .filter((i) => i.quantity > 0);
  const shippingTotal = (payload.shipping_lines || []).reduce((s, l) => {
    const price = Number.parseFloat(l.discounted_price ?? l.price) || 0;
    return s + price;
  }, 0);
  return {
    shopifyOrderName: payload.name || "",
    customerName: [shipping.first_name, shipping.last_name].filter(Boolean).join(" ") || payload.customer?.first_name || "Client",
    customerEmail: payload.email || payload.customer?.email || "",
    customerPhone: shipping.phone || payload.phone || "",
    shippingAddress1: shipping.address1 || "",
    shippingCity: shipping.city || "",
    shippingCounty: shipping.province || "",
    shippingCountry: shipping.country || "Romania",
    shippingZip: shipping.zip || "",
    ...companyFrom(payload.billing_address || shipping, payload.note_attributes),
    shippingTotal: round2(shippingTotal),
    lineItems,
  };
}

// B2B: company name from the billing address; VAT code (CUI) from the checkout
// attributes Picklo's widget or other apps add, or from the company line itself ("SC X SRL, RO123").
function companyFrom(address = {}, attributes = []) {
  const attr = (names) => (attributes || []).find((a) => names.includes(String(a.name || a.key || "").toLowerCase()))?.value;
  const company = (address.company || "").trim();
  let vat = attr(["cui", "cif", "vat", "vat_number", "cod fiscal", "picklo_cui"]) || "";
  if (!vat) vat = company.match(/\b(RO)?\s?\d{2,10}\b/i)?.[0] || "";
  if (!company || !vat) return {};
  return {
    customerCompany: company.replace(vat, "").replace(/[,\s]+$/, "").trim() || company,
    customerVatCode: vat.replace(/\s/g, "").toUpperCase(),
    customerRegCom: attr(["reg_com", "nr_reg_com", "registrul comertului", "picklo_regcom"]) || undefined,
  };
}

// Same shape from the GraphQL Admin API (used when no webhook payload is at hand, e.g. on delivery)
export async function fetchOrderForInvoice(admin, shopifyOrderId) {
  const res = await admin.graphql(`query ($id: ID!) { order(id: $id) {
      name email phone
      shippingAddress { firstName lastName address1 city province country phone zip company }
      billingAddress { company }
      customAttributes { key value }
      lineItems(first: 100) { nodes { name sku quantity currentQuantity
        discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } } }
      shippingLines(first: 5) { nodes { discountedPriceSet { shopMoney { amount } } } }
    } }`, { variables: { id: `gid://shopify/Order/${shopifyOrderId}` } });
  const o = (await res.json()).data?.order;
  if (!o) throw new Error("Comanda nu a fost gasita in Shopify");
  const a = o.shippingAddress || {};
  return {
    shopifyOrderName: o.name,
    customerName: [a.firstName, a.lastName].filter(Boolean).join(" ") || "Client",
    customerEmail: o.email || "",
    customerPhone: a.phone || o.phone || "",
    shippingAddress1: a.address1 || "",
    shippingCity: a.city || "",
    shippingCounty: a.province || "",
    shippingCountry: a.country || "Romania",
    shippingZip: a.zip || "",
    ...companyFrom({ company: o.billingAddress?.company || a.company }, o.customAttributes),
    shippingTotal: round2(o.shippingLines.nodes.reduce((s, l) => s + Number(l.discountedPriceSet.shopMoney.amount), 0)),
    lineItems: o.lineItems.nodes
      .map((i) => ({ name: i.name, sku: i.sku || "", quantity: i.currentQuantity ?? i.quantity,
        unitPrice: round2(Number(i.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount)) }))
      .filter((i) => i.quantity > 0),
  };
}

// Issues the invoice once per order. `orderData` is a normalized order.
export async function issueInvoice(shop, dbOrder, orderData) {
  if (dbOrder.invoiceNumber && dbOrder.invoiceStatus !== "cancelled") return { skipped: "already_invoiced" };
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const cfg = invoiceProviderConfig(settings);
  if (!cfg) return { skipped: "invoicing_off" };

  const args = { ...cfg.creds, series: cfg.series, tva: cfg.tva, currency: cfg.currency,
    order: { ...orderData, idempotencyKey: `picklo-${shop}-${dbOrder.shopifyOrderId}` } };
  // B2B: official company name, VAT status and registry number from ANAF
  const order = await enrichCompany({ ...args.order,
    customerCompany: orderData.customerCompany || dbOrder.customerCompany,
    customerVatCode: orderData.customerVatCode || dbOrder.customerVatCode,
    customerRegCom: orderData.customerRegCom || dbOrder.customerRegCom });
  const doc = await PROVIDERS[cfg.provider].create({ ...args, order });

  await prisma.order.update({
    where: { id: dbOrder.id },
    data: { invoiceProvider: cfg.provider, invoiceSeries: doc.series, invoiceNumber: doc.number, invoiceUrl: doc.url,
      invoiceStatus: "issued", invoiceReverseNumber: null, invoiceIssuedAt: new Date() },
  });
  await logActivity({ shop, order: dbOrder, action: "invoice_issued", message: `Factura ${doc.series}${doc.number} emisă (${cfg.provider})`, actor: "automation" });
  // FGO can print the AWB on the invoice
  if (cfg.provider === "fgo" && dbOrder.awbNumber) {
    await fgoAttachAwb({ ...cfg.creds, series: doc.series, number: doc.number, awbNumber: dbOrder.awbNumber }).catch(() => {});
  }
  return doc;
}

// Backwards-compatible entry point used by the order webhooks
export async function generateInvoiceForOrder(shop, shopifyOrderPayload) {
  const dbOrder = await prisma.order.findFirst({ where: { shop, shopifyOrderId: String(shopifyOrderPayload.id) } });
  if (!dbOrder) return null;
  return issueInvoice(shop, dbOrder, normalizeWebhookOrder(shopifyOrderPayload));
}

// mode: "cancel" (void the document) | "reverse" (storno / credit note)
export async function undoInvoice(shop, dbOrder, mode) {
  if (!dbOrder.invoiceNumber || !["issued", "collected"].includes(dbOrder.invoiceStatus)) return { skipped: "no_active_invoice" };
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const cfg = invoiceProviderConfig(settings);
  if (!cfg || cfg.provider !== dbOrder.invoiceProvider) return { skipped: "provider_unavailable" };

  const args = { ...cfg.creds, series: dbOrder.invoiceSeries, number: dbOrder.invoiceNumber };
  if (mode === "reverse") {
    const storno = await PROVIDERS[cfg.provider].reverse(args);
    await prisma.order.update({ where: { id: dbOrder.id }, data: { invoiceStatus: "reversed", invoiceReverseNumber: `${storno.series}${storno.number}` } });
    await logActivity({ shop, order: dbOrder, action: "invoice_reversed", message: `Storno ${storno.series}${storno.number} pentru ${dbOrder.invoiceSeries}${dbOrder.invoiceNumber}`, actor: "automation" });
    return { reversed: storno };
  }
  await PROVIDERS[cfg.provider].cancel(args);
  await prisma.order.update({ where: { id: dbOrder.id }, data: { invoiceStatus: "cancelled" } });
  await logActivity({ shop, order: dbOrder, action: "invoice_cancelled", message: `Factura ${dbOrder.invoiceSeries}${dbOrder.invoiceNumber} anulată`, actor: "automation" });
  return { cancelled: true };
}

// Cash on delivery collected by the courier → record the payment on the invoice
export async function collectInvoice(shop, dbOrder) {
  if (!dbOrder.invoiceNumber || dbOrder.invoiceStatus !== "issued") return { skipped: "no_open_invoice" };
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const cfg = invoiceProviderConfig(settings);
  if (!cfg || cfg.provider !== dbOrder.invoiceProvider) return { skipped: "provider_unavailable" };

  const args = { ...cfg.creds, series: dbOrder.invoiceSeries, number: dbOrder.invoiceNumber };
  await PROVIDERS[cfg.provider].collect({
    ...args,
    documentNumber: dbOrder.awbNumber ? `AWB ${dbOrder.awbNumber}` : undefined,   // Oblio
    amount: dbOrder.codCollectedAmount ?? dbOrder.codAmount ?? dbOrder.orderTotal, // FGO
  });
  await prisma.order.update({ where: { id: dbOrder.id }, data: { invoiceStatus: "collected" } });
  await logActivity({ shop, order: dbOrder, action: "invoice_collected", message: `Încasare înregistrată pe ${dbOrder.invoiceSeries}${dbOrder.invoiceNumber}`, actor: "automation" });
  return { collected: true };
}
