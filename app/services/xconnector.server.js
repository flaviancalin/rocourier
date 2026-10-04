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
import { fulfillOrderWithTracking, mergeOrderAttributes, setOrderMetafields } from "./fulfillment.server.js";

// ─────────────────────────────────────────────────────────────────────────────
// Push AWB to Shopify fulfillment (this makes your order xConnector-readable)
// GraphQL Admin API: fulfillmentCreate + orderUpdate (custom attributes)
// ─────────────────────────────────────────────────────────────────────────────
export async function syncAwbToShopify({
  adminApiClient,         // from authenticate.admin(request)
  shopifyOrderId,         // numeric Shopify order ID
  awbNumber,
  courierType,            // "fan" | "sameday" | "cargus" | "gls" | "packeta"
  pickupPointName = null,
  pickupPointAddress = null,
  markAsDispatched = false, // merchant opted in to fulfilling the order in Shopify
  notifyCustomer = false,   // merchant opted in to Shopify's shipping email
}) {
  let result = { skipped: true };
  if (markAsDispatched) {
    result = await fulfillOrderWithTracking(adminApiClient, {
      shopifyOrderId, courierType, awbNumber, notifyCustomer,
    });
    if (result.error) console.warn(`Fulfillment for order ${shopifyOrderId} skipped: ${result.error}`);
  }

  // Pickup point info on the order's attributes (xConnector reads these)
  if (pickupPointName) {
    await mergeOrderAttributes(adminApiClient, shopifyOrderId, {
      rocourier_awb:            awbNumber,
      rocourier_courier:        courierType,
      rocourier_pickup_name:    pickupPointName,
      rocourier_pickup_address: pickupPointAddress || "",
    });
  }

  return result;
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
  try {
    await setOrderMetafields(adminApiClient, shopifyOrderId, "rocourier", {
      awb_number:        awbNumber,
      courier_type:      courierType,
      pickup_point_id:   pickupPointId,
      pickup_point_name: pickupPointName,
    });
  } catch (e) {
    console.error("Metafield write failed:", e.message);
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
