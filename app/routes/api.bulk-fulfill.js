// app/routes/api.bulk-fulfill.js
// Marks multiple orders as fulfilled in Shopify with their AWB tracking info
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fulfillOrderWithTracking } from "../services/fulfillment.server.js";

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
      const result = await fulfillOrderWithTracking(admin, {
        shopifyOrderId: order.shopifyOrderId,
        courierType:    order.courierType,
        awbNumber:      order.awbNumber,
      });
      if (result.error) {
        results.push({ orderId: order.id, orderName: order.shopifyOrderName, success: false, error: result.error });
        continue;
      }

      results.push({
        orderId:       order.id,
        orderName:     order.shopifyOrderName,
        success:       true,
        fulfillmentId: result.fulfillmentId,
      });
    } catch (e) {
      results.push({
        orderId:   order.id,
        orderName: order.shopifyOrderName,
        success:   false,
        error:     e.message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;

  return json({ results, succeeded, failed });
}
