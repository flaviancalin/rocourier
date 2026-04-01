// app/routes/webhooks.orders-updated.jsx
// Handles Shopify ORDERS_UPDATED webhook.
// Updates our local order record if the customer details or shipping change.

import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_UPDATED") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const order = payload;
    const existing = await prisma.order.findFirst({
      where: { shop, shopifyOrderId: String(order.id) },
    });

    if (!existing) {
      // Order doesn't exist in our DB yet — could be a pre-app order, skip
      return new Response(null, { status: 200 });
    }

    // Re-read cart attributes in case they were updated
    const attrs = (order.note_attributes || []).reduce((acc, a) => {
      acc[a.name] = a.value;
      return acc;
    }, {});

    const updates = {
      customerName: [
        order.shipping_address?.first_name,
        order.shipping_address?.last_name,
      ].filter(Boolean).join(" ") || existing.customerName,
      customerPhone: order.shipping_address?.phone || existing.customerPhone,
      customerEmail: order.customer?.email || existing.customerEmail,
      shippingAddress1: order.shipping_address?.address1 || existing.shippingAddress1,
      shippingCity:     order.shipping_address?.city     || existing.shippingCity,
      shippingCounty:   order.shipping_address?.province || existing.shippingCounty,
      shippingZip:      order.shipping_address?.zip      || existing.shippingZip,
      codAmount:        parseFloat(order.total_price)    || existing.codAmount,
      orderTotal:       parseFloat(order.total_price)    || existing.orderTotal,
      updatedAt:        new Date(),
    };

    // Only update delivery choice if AWB hasn't been generated yet
    if (existing.awbStatus === "pending" && attrs["_rocourier_method"]) {
      updates.shippingMethod  = attrs["_rocourier_method"];
      updates.courierType     = attrs["_rocourier_courier"]  || existing.courierType;
      updates.pickupPointId   = attrs["_rocourier_point_id"] || null;
      updates.pickupPointName = attrs["_rocourier_point_name"] || null;
    }

    await prisma.order.update({
      where: { id: existing.id },
      data: updates,
    });

  } catch (err) {
    console.error("Webhook ORDERS_UPDATED error:", err);
  }

  return new Response(null, { status: 200 });
};
