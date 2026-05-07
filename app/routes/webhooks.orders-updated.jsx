// app/routes/webhooks.orders-updated.jsx
// Handles Shopify ORDERS_UPDATED webhook.
// Updates our local order record if the customer details or shipping change.

import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
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
      return new Response(null, { status: 200 });
    }

    // Support both _rc_ (current widget) and _rocourier_ (legacy) attribute prefixes
    const attrs = (order.note_attributes || []).reduce((acc, a) => {
      acc[a.name] = a.value;
      return acc;
    }, {});

    const rcMethod   = attrs["_rc_method"]        || attrs["_rocourier_method"]        || null;
    const rcCourier  = attrs["_rc_courier"]       || attrs["_rocourier_courier"]       || null;
    const rcPointId  = attrs["_rc_point_id"]      || attrs["_rocourier_point_id"]      || null;
    const rcPointName= attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;

    const updates = {
      customerName:     [order.shipping_address?.first_name, order.shipping_address?.last_name].filter(Boolean).join(" ") || existing.customerName,
      customerPhone:    order.shipping_address?.phone || existing.customerPhone,
      customerEmail:    order.customer?.email         || existing.customerEmail,
      shippingAddress1: order.shipping_address?.address1 || existing.shippingAddress1,
      shippingCity:     order.shipping_address?.city     || existing.shippingCity,
      shippingCounty:   order.shipping_address?.province || existing.shippingCounty,
      shippingZip:      order.shipping_address?.zip      || existing.shippingZip,
      codAmount:        parseFloat(order.total_price)    || existing.codAmount,
      orderTotal:       parseFloat(order.total_price)    || existing.orderTotal,
      updatedAt:        new Date(),
    };

    // Only update delivery choice if AWB hasn't been generated yet
    if (existing.awbStatus === "pending" && rcMethod) {
      updates.shippingMethod  = rcMethod;
      updates.courierType     = rcCourier  || existing.courierType;
      updates.pickupPointId   = rcPointId  || null;
      updates.pickupPointName = rcPointName || null;
    }

    await prisma.order.update({ where: { id: existing.id }, data: updates });

  } catch (err) {
    logError("Webhook ORDERS_UPDATED", err);
  }

  return new Response(null, { status: 200 });
};
