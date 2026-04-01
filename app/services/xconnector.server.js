// app/services/xconnector.server.js
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  IMPORTANT: WHAT IS xCONNECTOR?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// xConnector (by InfoQuest, apps.shopify.com/xconnector) is a SEPARATE Shopify
// app — not a public REST API you can freely call. It does NOT publish an open
// partner API. It reads from and writes to Shopify's native data structures
// (orders, fulfillments, metafields).
//
// ── HOW THE INTEGRATION WORKS IN PRACTICE ───────────────────────────────────
// Your app writes AWB data to Shopify ORDER METAFIELDS and/or ORDER NOTES.
// xConnector already reads these standard Shopify fields — so your app is
// "xConnector-compatible" automatically once you:
//   1. Write AWB number to the standard fulfillment tracking_number field
//   2. Write courier name to the tracking_company field
//   3. Write pickup point data to order note_attributes
//
// If you want DIRECT integration:
//   → Contact InfoQuest at office@infoquest.ro or support@xconnector.app
//   → Ask for their "Partner API" or a webhook they can consume
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { prisma } from "../db.server.js";

// ─────────────────────────────────────────────────────────────────────────────
// Push AWB to Shopify fulfillment (this makes your order xConnector-readable)
// Uses Shopify Admin API → Orders → Fulfillments
// ─────────────────────────────────────────────────────────────────────────────
export async function syncAwbToShopify({
  adminApiClient,         // from authenticate.admin(request)
  shopifyOrderId,         // numeric Shopify order ID
  awbNumber,
  courierType,            // "fan" | "sameday"
  trackingUrl,
  pickupPointName = null,
  pickupPointAddress = null,
}) {
  const trackingCompany = courierType === "fan" ? "FAN Courier" : "Sameday Courier";
  const defaultTrackingUrl = courierType === "fan"
    ? `https://www.fancourier.ro/awb-tracking/?awb=${awbNumber}`
    : `https://sameday.ro/awb/?awb=${awbNumber}`;

  // Step 1: Get fulfillment orders for this Shopify order
  const fulfillmentOrdersResp = await adminApiClient.rest.get({
    path: `orders/${shopifyOrderId}/fulfillment_orders`,
  });

  const fulfillmentOrders = fulfillmentOrdersResp.body?.fulfillment_orders || [];
  if (fulfillmentOrders.length === 0) {
    console.warn(`No fulfillment orders found for Shopify order ${shopifyOrderId}`);
    return null;
  }

  // Step 2: Create fulfillment with tracking info
  const lineItems = fulfillmentOrders.flatMap((fo) =>
    fo.line_items.map((li) => ({
      fulfillment_order_id: fo.id,
      fulfillment_order_line_item_id: li.id,
      quantity: li.fulfillable_quantity,
    }))
  );

  const fulfillmentPayload = {
    fulfillment: {
      line_items_by_fulfillment_order: lineItems,
      tracking_info: {
        number: awbNumber,
        company: trackingCompany,
        url: trackingUrl || defaultTrackingUrl,
      },
      notify_customer: true,
    },
  };

  const fulfillmentResp = await adminApiClient.rest.post({
    path: "fulfillments",
    data: fulfillmentPayload,
    type: adminApiClient.rest.DataType.JSON,
  });

  const fulfillment = fulfillmentResp.body?.fulfillment;

  // Step 3: Write pickup point info to order note_attributes (xConnector reads these)
  if (pickupPointName) {
    await adminApiClient.rest.put({
      path: `orders/${shopifyOrderId}`,
      data: {
        order: {
          id: shopifyOrderId,
          note_attributes: [
            { name: "rocourier_awb", value: awbNumber },
            { name: "rocourier_courier", value: courierType },
            { name: "rocourier_pickup_name", value: pickupPointName || "" },
            { name: "rocourier_pickup_address", value: pickupPointAddress || "" },
          ],
        },
      },
      type: adminApiClient.rest.DataType.JSON,
    });
  }

  return fulfillment;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write AWB data to Shopify Order Metafields
// Namespace: rocourier — these are readable by xConnector and other apps
// ─────────────────────────────────────────────────────────────────────────────
export async function writeOrderMetafields({
  adminApiClient,
  shopifyOrderId,
  awbNumber,
  courierType,
  pickupPointId,
  pickupPointName,
}) {
  const metafields = [
    { key: "awb_number", value: awbNumber, type: "single_line_text_field" },
    { key: "courier_type", value: courierType, type: "single_line_text_field" },
    { key: "pickup_point_id", value: pickupPointId || "", type: "single_line_text_field" },
    { key: "pickup_point_name", value: pickupPointName || "", type: "single_line_text_field" },
  ];

  for (const mf of metafields) {
    try {
      await adminApiClient.rest.post({
        path: `orders/${shopifyOrderId}/metafields`,
        data: {
          metafield: {
            namespace: "rocourier",
            ...mf,
          },
        },
        type: adminApiClient.rest.DataType.JSON,
      });
    } catch (e) {
      console.error(`Metafield write failed for ${mf.key}:`, e.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark order as synced in our local DB
// ─────────────────────────────────────────────────────────────────────────────
export async function markXConnectorSynced(orderId) {
  await prisma.order.update({
    where: { id: orderId },
    data: { xconnectorSynced: true, xconnectorSyncAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Future: Direct xConnector Partner API (contact them to activate)
// Placeholder for when InfoQuest provides API keys to partners
// ─────────────────────────────────────────────────────────────────────────────
export async function xconnectorDirectSync({ apiKey, orderId, awbNumber, courier }) {
  if (!apiKey) {
    console.log("xConnector direct API not configured — using Shopify metafields instead");
    return { skipped: true };
  }

  // TODO: Replace with actual xConnector partner endpoint once available
  // Contact: office@infoquest.ro to get partner API access
  const XCONNECTOR_API = "https://app.xconnector.app/api/partner";

  try {
    const res = await fetch(`${XCONNECTOR_API}/orders/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId, awb: awbNumber, courier }),
    });

    if (res.ok) return await res.json();
    console.error("xConnector direct sync failed:", await res.text());
    return { error: true };
  } catch (e) {
    console.error("xConnector direct sync error:", e.message);
    return { error: true };
  }
}
