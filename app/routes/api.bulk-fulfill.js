// app/routes/api.bulk-fulfill.js
// Marks multiple orders as fulfilled in Shopify with their AWB tracking info
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const COURIER_TRACKING = {
  fan:     { company: "FAN Courier",    url: (awb) => `https://www.fancourier.ro/awb-tracking/?awb=${awb}` },
  sameday: { company: "Sameday",        url: (awb) => `https://sameday.ro/awb/?awb=${awb}` },
  cargus:  { company: "Cargus",         url: (awb) => `https://urgentcargus.ro/tracking/${awb}` },
  gls:     { company: "GLS Romania",    url: (awb) => `https://gls-group.com/RO/en/parcel-tracking/?match=${awb}` },
  packeta: { company: "Packeta",        url: (awb) => `https://tracking.packeta.com/?id=${awb}` },
};

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const { orderIds } = await request.json();
  if (!Array.isArray(orderIds) || !orderIds.length) {
    return json({ error: "No orderIds provided" }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { shop, id: { in: orderIds }, awbNumber: { not: null } },
  });

  const results = [];

  for (const order of orders) {
    try {
      const tracking = COURIER_TRACKING[order.courierType] || {
        company: order.courierType,
        url: () => "",
      };

      // Get fulfillment orders for this Shopify order
      const foResp = await admin.rest.get({
        path: `orders/${order.shopifyOrderId}/fulfillment_orders`,
      });

      const fulfillmentOrders = foResp.body?.fulfillment_orders || [];

      // Only pick open/in_progress fulfillment orders
      const openFOs = fulfillmentOrders.filter((fo) =>
        ["open", "in_progress"].includes(fo.status)
      );

      if (!openFOs.length) {
        results.push({ orderId: order.id, orderName: order.shopifyOrderName, success: false, error: "Already fulfilled or no open fulfillment orders" });
        continue;
      }

      const lineItems = openFOs.flatMap((fo) =>
        (fo.line_items || [])
          .filter((li) => li.fulfillable_quantity > 0)
          .map((li) => ({
            fulfillment_order_id: fo.id,
            fulfillment_order_line_item_id: li.id,
            quantity: li.fulfillable_quantity,
          }))
      );

      if (!lineItems.length) {
        results.push({ orderId: order.id, orderName: order.shopifyOrderName, success: false, error: "No fulfillable items" });
        continue;
      }

      const fulfillResp = await admin.rest.post({
        path: "fulfillments",
        data: {
          fulfillment: {
            line_items_by_fulfillment_order: lineItems,
            tracking_info: {
              number: order.awbNumber,
              company: tracking.company,
              url: tracking.url(order.awbNumber),
            },
            notify_customer: false,
          },
        },
        type: admin.rest.DataType?.JSON || "application/json",
      });

      const fulfillment = fulfillResp.body?.fulfillment;
      results.push({
        orderId: order.id,
        orderName: order.shopifyOrderName,
        success: true,
        fulfillmentId: fulfillment?.id,
      });
    } catch (e) {
      results.push({
        orderId: order.id,
        orderName: order.shopifyOrderName,
        success: false,
        error: e.message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;

  return json({ results, succeeded, failed });
}
