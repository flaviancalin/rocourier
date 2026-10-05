// app/routes/webhooks.orders-cancelled.jsx
// Shopify fires this when an order is cancelled.
// Marks the order cancelled (AWB buttons hidden) and runs the cancellation automations.
import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { prisma } from "../db.server.js";
import { onShopifyOrderCancelled } from "../services/automations.server.js";

export const loader = async () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CANCELLED") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const shopifyOrderId = String(payload.id);
    const order = await prisma.order.findFirst({ where: { shop, shopifyOrderId } });
    if (order && !order.shopifyCancelledAt) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          shopifyCancelledAt: new Date(payload.cancelled_at || Date.now()),
          financialStatus: payload.financial_status || order.financialStatus,
        },
      });
      // Automations (delete AWB, cancel/reverse invoice…) run in the background so the
      // webhook answers within Shopify's timeout; the order is marked cancelled after.
      onShopifyOrderCancelled(shop, order)
        .catch((err) => logError("cancel automations", err))
        .finally(() => prisma.order.update({ where: { id: order.id }, data: { awbStatus: "cancelled" } }).catch(() => {}));
    }
  } catch (err) {
    logError("Webhook ORDERS_CANCELLED", err);
  }

  return new Response(null, { status: 200 });
};
