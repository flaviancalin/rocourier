// app/services/automations.server.js
// Picklo automations connecting Shopify, the courier and the invoicing provider.
// Every automation is opt-in (ShopSettings flags, all off by default) and each step
// is isolated: one failing step is logged and never blocks the others.

import { prisma } from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import { deleteAwbForOrder } from "./awb.server.js";
import { issueInvoice, undoInvoice, collectInvoice, fetchOrderForInvoice } from "./invoice.server.js";
import { cancelShopifyOrder, markShopifyOrderPaid, setStatusTag, copyCustomerPhoneToShipping } from "./shopify-orders.server.js";

async function step(label, order, fn) {
  try {
    const result = await fn();
    console.log(`[Automation] ${label} ${order.shopifyOrderName} (${order.shop}):`, JSON.stringify(result ?? "ok").slice(0, 200));
    return result;
  } catch (e) {
    console.error(`[Automation] ${label} failed for ${order.shopifyOrderName} (${order.shop}):`, e.message);
    return null;
  }
}

const adminFor = async (shop) => (await unauthenticated.admin(shop)).admin;
const isCashOnDelivery = (order) => ["pending", "partially_paid", "authorized"].includes(order.financialStatus);

// ── Auto-AWB filter (orders/create) ─────────────────────────────────────────
export function shouldAutoGenerateAwb(settings, payload, dbOrder) {
  if (!settings?.autoGenerateAwb) return false;
  switch (settings.autoAwbFilter) {
    case "cod":    return ["pending", "partially_paid"].includes(payload.financial_status);
    case "paid":   return payload.financial_status === "paid";
    case "pickup": return dbOrder?.shippingMethod === "pickup_point";
    default:       return true;
  }
}

// ── New order: fill a missing shipping phone (couriers and lockers need it) ──
export async function onOrderCreated(shop, settings, dbOrder) {
  // Always checks Shopify: Picklo may already know the phone (from the shipping line)
  // while the order's shipping address — what packing slips and other apps read — has none.
  if (!settings?.copyCustomerPhone) return;
  await step("copy phone", dbOrder, async () => {
    const phone = await copyCustomerPhoneToShipping(await adminFor(shop), dbOrder.shopifyOrderId);
    if (phone && phone !== dbOrder.customerPhone) await prisma.order.update({ where: { id: dbOrder.id }, data: { customerPhone: phone } });
    return { phone: phone ? "copied" : "none available" };
  });
}

// ── Shopify order cancelled ─────────────────────────────────────────────────
export async function onShopifyOrderCancelled(shop, dbOrder) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return;
  const admin = (settings.onCancelDeleteAwb && dbOrder.awbNumber) || settings.statusTags ? await adminFor(shop) : null;

  if (settings.onCancelDeleteAwb && dbOrder.awbNumber && !["delivered", "returned"].includes(dbOrder.awbStatus)) {
    await step("delete AWB on cancel", dbOrder, () => deleteAwbForOrder(admin, dbOrder, settings));
  }
  if (settings.onCancelInvoice !== "none") {
    await step(`${settings.onCancelInvoice} invoice on cancel`, dbOrder, () => undoInvoice(shop, dbOrder, settings.onCancelInvoice));
  }
  if (settings.statusTags) await step("tag cancelled", dbOrder, () => setStatusTag(admin, dbOrder.shopifyOrderId, "cancelled"));
}

// ── Order fully refunded (not cancelled) ────────────────────────────────────
export async function onOrderRefunded(shop, settings, dbOrder) {
  if (!settings?.onRefundReverseInvoice) return;
  await step("reverse invoice on refund", dbOrder, () => undoInvoice(shop, dbOrder, "reverse"));
}

// ── Courier status changed (tracking sync) ──────────────────────────────────
export async function onShipmentStatusChanged(settings, dbOrder, newStatus) {
  const shop = dbOrder.shop;
  const needsAdmin = settings.statusTags
    || (newStatus === "delivered" && (settings.onDeliveredMarkPaid || settings.autoInvoiceOnDelivered))
    || (newStatus === "returned" && settings.onReturnedCancelOrder);
  if (!needsAdmin && !(newStatus === "returned" && settings.onReturnedInvoice !== "none")) return;
  const admin = needsAdmin ? await adminFor(shop) : null;

  if (settings.statusTags) await step(`tag ${newStatus}`, dbOrder, () => setStatusTag(admin, dbOrder.shopifyOrderId, newStatus));

  if (newStatus === "delivered") {
    let order = dbOrder;
    if (settings.autoInvoiceOnDelivered && !order.invoiceNumber) {
      await step("invoice on delivery", order, async () => issueInvoice(shop, order, await fetchOrderForInvoice(admin, order.shopifyOrderId)));
      order = await prisma.order.findUnique({ where: { id: order.id } });
    }
    // Cash on delivery: the courier collected the money
    if (settings.onDeliveredMarkPaid && isCashOnDelivery(order)) {
      await step("mark paid on delivery", order, () => markShopifyOrderPaid(admin, order.shopifyOrderId));
      await prisma.order.update({ where: { id: order.id }, data: { financialStatus: "paid" } });
      await step("collect invoice (ramburs)", order, () => collectInvoice(shop, order));
    }
  }

  if (newStatus === "returned") {
    // Invoice first: cancelling the order fires orders/cancelled, which must then find
    // the invoice already handled instead of applying its own cancel action.
    if (settings.onReturnedInvoice !== "none") {
      await step(`${settings.onReturnedInvoice} invoice on return`, dbOrder, () => undoInvoice(shop, dbOrder, settings.onReturnedInvoice));
    }
    if (settings.onReturnedCancelOrder && !dbOrder.shopifyCancelledAt) {
      await step("cancel order on return", dbOrder, () => cancelShopifyOrder(admin, dbOrder.shopifyOrderId, {
        staffNote: `Picklo: colet returnat (AWB ${dbOrder.awbNumber || "-"})`,
      }));
    }
  }
}
