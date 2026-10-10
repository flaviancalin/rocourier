// app/routes/api.sync-orders.js
// "Sync from Shopify" button on the Orders page — logic in services/order-sync.server.js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { syncOrdersForShop } from "../services/order-sync.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  try {
    const result = await syncOrdersForShop(admin, session.shop);
    return json(result.error ? { error: result.error } : result, { status: result.error ? 502 : 200 });
  } catch (e) {
    console.error("[sync-orders] error for shop", session.shop, ":", e?.message || e);
    return json({ error: e?.message || "Sync failed" }, { status: 500 });
  }
}

