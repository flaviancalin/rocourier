// app/routes/webhooks.orders-create.jsx
// Shopify fires this when a new order is placed.
// Saves the order to our DB and optionally auto-generates an AWB.

import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { upsertOrderFromWebhook } from "../models/order.server.js";
import { updateOrderAwb } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { fanCreateAwb } from "../services/fan-courier.server.js";
import { cargusCreateAwb, cargusGetSenderLocations } from "../services/cargus.server.js";
import { glsCreateAwb } from "../services/gls.server.js";
import { packetaCreatePacket } from "../services/packeta.server.js";
// Sameday auto-AWB not supported: requires county/city geo ID lookup

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const order = await upsertOrderFromWebhook(shop, payload);
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (settings?.autoGenerateAwb) {
      const courier = order.courierType || settings.defaultCourier || "fan";
      const orderData = { ...order, weight: order.weight || settings.defaultWeight || 1 };
      let awbResult = null;

      try {
        if (courier === "fan" && settings.fanEnabled && settings.fanClientId) {
          awbResult = await fanCreateAwb({
            clientId:  settings.fanClientId,
            username:  settings.fanUsername,
            password:  settings.fanPassword,
            order:     orderData,
            settings,
            pickupPointId: order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
          });

        } else if (courier === "cargus" && settings.cargusEnabled && settings.cargusSubscriptionKey) {
          const locations = await cargusGetSenderLocations({
            subscriptionKey: settings.cargusSubscriptionKey,
            username:        settings.cargusUsername,
            password:        settings.cargusPassword,
          });
          if (locations[0]) {
            awbResult = await cargusCreateAwb({
              subscriptionKey:  settings.cargusSubscriptionKey,
              username:         settings.cargusUsername,
              password:         settings.cargusPassword,
              order:            orderData,
              senderLocationId: locations[0].LocationId || locations[0].locationId,
              pudoPointId:      order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
            });
          }

        } else if (courier === "gls" && settings.glsEnabled && settings.glsUsername) {
          awbResult = await glsCreateAwb({
            username:     settings.glsUsername,
            password:     settings.glsPassword,
            sandbox:      !!settings.glsSandbox,
            order:        orderData,
            settings,
            clientNumber: parseInt(settings.glsClientNumber) || 0,
            pickupPointId: order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
          });

        } else if (courier === "packeta" && settings.packetaEnabled && settings.packetaApiKey) {
          awbResult = await packetaCreatePacket({
            apiKey:       settings.packetaApiKey,
            order:        orderData,
            settings,
            pickupPointId: order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
          });
        }

        if (awbResult?.success) {
          await updateOrderAwb(order.id, {
            awbNumber:   awbResult.awbNumber,
            awbStatus:   "generated",
            courierType: courier, // persist the courier actually used
          });
        }

      } catch (awbErr) {
        logError("auto-awb", awbErr, { order: order.shopifyOrderName });
      }
    }

  } catch (err) {
    logError("Webhook ORDERS_CREATE", err);
  }

  return new Response(null, { status: 200 });
};
