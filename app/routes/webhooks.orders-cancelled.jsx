// app/routes/webhooks.orders-cancelled.jsx
// Shopify fires this when an order is cancelled or fully refunded.
// We mark the order as cancelled in our DB so AWB buttons are hidden.
import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CANCELLED") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const shopifyOrderId = String(payload.id);

    await prisma.order.updateMany({
      where: { shop, shopifyOrderId },
      data: { awbStatus: "cancelled", updatedAt: new Date() },
    });
  } catch (err) {
    logError("Webhook ORDERS_CANCELLED", err);
  }

  return new Response(null, { status: 200 });
};
