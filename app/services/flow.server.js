// app/services/flow.server.js
// Shopify Flow triggers (extensions/picklo-flow-*). Merchants build their own
// automations on top of them: tag refused orders, email the team, notify the customer…
// Firing a trigger is best-effort: a store without Flow workflows simply ignores it.
import { unauthenticated } from "../shopify.server.js";
import { trackingFor } from "./fulfillment.server.js";

const legacyId = (id) => Number(String(id).split("/").pop());

async function fire(shop, admin, handle, payload) {
  try {
    const client = admin || (await unauthenticated.admin(shop)).admin;
    const res = await client.graphql(
      `mutation flowTriggerReceive($handle: String, $payload: JSON) {
        flowTriggerReceive(handle: $handle, payload: $payload) { userErrors { field message } }
      }`,
      { variables: { handle, payload } },
    );
    const errors = (await res.json()).data?.flowTriggerReceive?.userErrors || [];
    if (errors.length) console.warn(`[Flow] ${handle}:`, errors.map((e) => e.message).join("; "));
  } catch (e) {
    console.warn(`[Flow] ${handle} not sent:`, e.message);
  }
}

export function flowAwbCreated(shop, admin, order, awbNumber, courier) {
  return fire(shop, admin, "picklo-awb-created", {
    order_id: legacyId(order.shopifyOrderId),
    "AWB number": String(awbNumber),
    Courier: courier,
    "Tracking URL": trackingFor(courier, awbNumber).url || `https://${shop}`,
  });
}

export function flowStatusChanged(shop, order, status) {
  const base = { order_id: legacyId(order.shopifyOrderId), "AWB number": String(order.awbNumber || ""), Courier: order.courierType };
  const jobs = [fire(shop, null, "picklo-shipment-status-changed", { ...base, Status: status })];
  if (status === "returned") {
    jobs.push(fire(shop, null, "picklo-parcel-refused", { ...base, "Cash on delivery amount": Number(order.codAmount) || 0 }));
  }
  return Promise.all(jobs);
}

export function flowReturnRequested(shop, order, reason) {
  return fire(shop, null, "picklo-return-requested", { order_id: legacyId(order.shopifyOrderId), Reason: reason });
}
