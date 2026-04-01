// app/routes/webhooks.orders-create.jsx
// Shopify sends this when a new order is placed.
// We capture the RoCourier cart attributes and store the order locally.

import { authenticate } from "../shopify.server.js";
import { upsertOrderFromWebhook } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { fanCreateAwb } from "../services/fan-courier.server.js";
import { updateOrderAwb } from "../models/order.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload, session } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    // 1. Save order to our DB
    const order = await upsertOrderFromWebhook(shop, payload);

    // 2. Auto-generate AWB if enabled in settings
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (settings?.autoGenerateAwb) {
      try {
        const courier = order.courierType || settings.defaultCourier || "fan";

        if (courier === "fan" && settings.fanClientId) {
          const awbResult = await fanCreateAwb({
            clientId:   settings.fanClientId,
            username:   settings.fanUsername,
            password:   settings.fanPassword,
            order:      { ...order, weight: order.weight || settings.defaultWeight || 1 },
            settings,
            pickupPointId: order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
          });

          if (awbResult.success) {
            await updateOrderAwb(order.id, {
              awbNumber: awbResult.awbNumber,
              awbStatus: "generated",
            });
          }
        }
        // Sameday auto-AWB requires more context (county/city IDs) — skip for now
        // Add samedayCreateAwb here once you have the geo mapping logic

      } catch (awbErr) {
        // Log but don't fail the webhook — order is already saved
        console.error(`Auto AWB failed for order ${order.shopifyOrderName}:`, awbErr.message);
      }
    }

  } catch (err) {
    console.error("Webhook ORDERS_CREATE error:", err);
    // Return 200 anyway — Shopify will retry on 4xx/5xx
  }

  return new Response(null, { status: 200 });
};
