// app/services/invoice.server.js
// Shared helper — routes invoice generation to the configured provider.

import { smartbillCreateInvoice } from "./smartbill.server.js";
import { oblioCreateInvoice } from "./oblio.server.js";
import { prisma } from "../db.server.js";

export async function generateInvoiceForOrder(shop, shopifyOrderPayload) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings?.invoiceProvider) return null;

  const order = buildOrderData(shopifyOrderPayload);

  if (settings.invoiceProvider === "smartbill" && settings.smartbillEnabled && settings.smartbillEmail && settings.smartbillToken) {
    return smartbillCreateInvoice({
      email:    settings.smartbillEmail,
      token:    settings.smartbillToken,
      cif:      settings.smartbillCompanyCIF,
      series:   settings.smartbillSeries,
      tva:      settings.smartbillTVA || "19",
      currency: settings.smartbillCurrency || "RON",
      order,
    });
  }

  if (settings.invoiceProvider === "oblio" && settings.oblioEnabled && settings.oblioEmail && settings.oblioSecret) {
    return oblioCreateInvoice({
      email:    settings.oblioEmail,
      secret:   settings.oblioSecret,
      cif:      settings.oblioCIF,
      series:   settings.oblioSeries,
      tva:      settings.oblioTVA || "19",
      currency: settings.oblioCurrency || "RON",
      order,
    });
  }

  return null;
}

function buildOrderData(payload) {
  const shipping = payload.shipping_address || {};
  return {
    shopifyOrderName: payload.name || "",
    customerName:    [shipping.first_name, shipping.last_name].filter(Boolean).join(" ") || payload.customer?.first_name || "Client",
    customerEmail:   payload.customer?.email || payload.email || "",
    customerPhone:   shipping.phone || payload.phone || "",
    shippingAddress1: shipping.address1 || "",
    shippingCity:    shipping.city || "",
    shippingCounty:  shipping.province || "",
    shippingCountry: shipping.country || "Romania",
    orderTotal:      parseFloat(payload.total_price) || 0,
    shippingTotal:   parseFloat(payload.total_shipping_price_set?.shop_money?.amount) || 0,
    lineItems: (payload.line_items || []).map((item) => ({
      name:     item.name || item.title,
      sku:      item.sku  || "",
      quantity: item.quantity || 1,
      price:    parseFloat(item.price) || 0,
    })),
  };
}
