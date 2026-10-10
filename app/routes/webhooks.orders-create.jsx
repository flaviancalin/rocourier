// app/routes/webhooks.orders-create.jsx
// Shopify fires this when a new order is placed.
// Saves the order to our DB and optionally auto-generates an AWB.

import { authenticate, unauthenticated } from "../shopify.server.js";
import { generateAwbForOrder } from "../services/awb.server.js";
import { shouldAutoGenerateAwb, onOrderCreated } from "../services/automations.server.js";
import { logError } from "../utils/log.server.js";
import { upsertOrderFromWebhook } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { generateInvoiceForOrder } from "../services/invoice.server.js";
import { orderWarnings, courierFromRules } from "../services/order-checks.server.js";
import { logActivity } from "../services/activity.server.js";

// Problems that make an automatic AWB fail or bounce; others (e.g. past refusals) only warn
const BLOCKING_CHECKS = new Set(["locker_missing", "phone_missing", "phone_invalid", "address_missing", "city_missing", "name"]);

export const loader = async () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const order = await upsertOrderFromWebhook(shop, payload);
    // Shopify retries webhooks that take longer than ~5s, which could create a second
    // AWB/invoice — answer right away and run the automations in the background.
    runOrderCreatedAutomations(shop, payload, order).catch((err) => logError("order automations", err));
  } catch (err) {
    logError("Webhook ORDERS_CREATE", err);
  }

  return new Response(null, { status: 200 });
};

async function runOrderCreatedAutomations(shop, payload, order) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return;

  // Missing shipping phone → couriers reject the AWB and lockers can't send the code
  await onOrderCreated(shop, settings, order);

  if (shouldAutoGenerateAwb(settings, payload, order)) {
    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    if (fresh && !fresh.awbNumber) {
      // Don't send a parcel the courier will bounce: missing locker, bad phone or address
      const blocking = (await orderWarnings(shop, fresh, settings)).filter((w) => BLOCKING_CHECKS.has(w.code));
      if (blocking.length) {
        await logActivity({ shop, order: fresh, action: "auto_awb_skipped", actor: "automation",
          message: `AWB automat oprit: ${blocking.map((w) => w.message).join("; ")}` });
      } else try {
        const { admin } = await unauthenticated.admin(shop);
        await generateAwbForOrder(admin, shop, order.id, {
          markAsDispatched: settings.autoAwbMarkShipped,
          notifyCustomer:   settings.autoAwbNotifyCustomer,
          recipientPhone:   fresh.customerPhone || undefined,
          courierOverride:  courierFromRules(settings, fresh) || undefined,
          actor:            "automation",
        });
      } catch (awbErr) {
        logError("auto-awb", awbErr, { order: order.shopifyOrderName });
      }
    }
  }

  // Auto-invoice on new order (issued once per order)
  if (settings.autoSendInvoice && settings.invoiceProvider) {
    try {
      await generateInvoiceForOrder(shop, payload);
    } catch (invoiceErr) {
      logError("auto-invoice (order create)", invoiceErr, { order: order?.shopifyOrderName });
    }
  }
}
