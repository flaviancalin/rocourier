// app/routes/api.generate-awb.js
// Called from the admin dashboard to generate an AWB for an order
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanCreateAwb } from "../services/fan-courier.server.js";
import { samedayCreateAwb, samedayGetClientPickupPoints, samedayGetServices } from "../services/sameday.server.js";
import { syncAwbToShopify, writeOrderMetafields } from "../services/xconnector.server.js";
import { updateOrderAwb } from "../models/order.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const formData = await request.json();
  const { orderId, courierOverride, weightOverride } = formData;

  // Load order and settings
  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) return json({ error: "Order not found" }, { status: 404 });
  if (!settings) return json({ error: "Shop not configured" }, { status: 400 });

  const courier = courierOverride || order.courierType;
  const orderData = {
    ...order,
    weight: weightOverride || order.weight || settings.defaultWeight || 1,
    shopifyOrderName: order.shopifyOrderName,
  };

  let awbResult;

  try {
    if (courier === "fan") {
      if (!settings.fanClientId || !settings.fanUsername || !settings.fanPassword) {
        return json({ error: "FAN Courier API credentials not configured" }, { status: 400 });
      }

      awbResult = await fanCreateAwb({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        order: orderData,
        settings,
        pickupPointId: order.shippingMethod === "pickup_point" ? order.pickupPointId : null,
      });

    } else if (courier === "sameday") {
      if (!settings.samedayUsername || !settings.samedayPassword) {
        return json({ error: "Sameday API credentials not configured" }, { status: 400 });
      }

      // Get sender pickup point and service IDs (Sameday uses numeric IDs)
      const [senderPickupPoints, services] = await Promise.all([
        samedayGetClientPickupPoints({
          username: settings.samedayUsername,
          password: settings.samedayPassword,
        }),
        samedayGetServices({
          username: settings.samedayUsername,
          password: settings.samedayPassword,
        }),
      ]);

      const senderPickupPoint = senderPickupPoints[0]; // use first configured sender location
      if (!senderPickupPoint) {
        return json({ error: "No sender pickup point configured in Sameday. Contact software@sameday.ro" }, { status: 400 });
      }

      // Find appropriate service
      const isLocker = order.shippingMethod === "pickup_point";
      const serviceCode = isLocker ? "LN" : "T"; // LN = Locker NextDay, T = Standard
      const service = services.find((s) => s.code === serviceCode) || services[0];

      awbResult = await samedayCreateAwb({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        order: orderData,
        settings,
        senderPickupPointId: senderPickupPoint.id,
        lockerDestId: isLocker ? order.pickupPointId : null,
        serviceId: service.id,
        serviceCode: service.code,
        countyId: order.samedayCountyId || null,
        cityId: order.samedayCityId || null,
      });
    }

    if (!awbResult?.success) {
      throw new Error("AWB generation returned unsuccessful result");
    }

    // Update our DB
    const updatedOrder = await updateOrderAwb(order.id, {
      awbNumber: awbResult.awbNumber,
      awbStatus: "generated",
    });

    // Sync to Shopify fulfillment (makes xConnector compatible)
    try {
      await syncAwbToShopify({
        adminApiClient: admin,
        shopifyOrderId: order.shopifyOrderId,
        awbNumber: awbResult.awbNumber,
        courierType: courier,
        pickupPointName: order.pickupPointName,
        pickupPointAddress: order.pickupPointAddress,
      });

      await writeOrderMetafields({
        adminApiClient: admin,
        shopifyOrderId: order.shopifyOrderId,
        awbNumber: awbResult.awbNumber,
        courierType: courier,
        pickupPointId: order.pickupPointId,
        pickupPointName: order.pickupPointName,
      });
    } catch (syncError) {
      // Non-fatal — AWB was created, just sync failed
      console.error("Shopify sync error (non-fatal):", syncError.message);
    }

    return json({
      success: true,
      awbNumber: awbResult.awbNumber,
      order: updatedOrder,
    });

  } catch (e) {
    console.error("AWB generation error:", e);
    return json({ error: e.message }, { status: 500 });
  }
}
