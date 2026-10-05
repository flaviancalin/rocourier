// app/routes/api.sync-orders.js
// Manually sync recent orders from the Shopify Admin GraphQL API into the local DB.
// Each order is converted to the webhook payload shape and saved through
// upsertOrderFromWebhook, so a synced order is identical to one received live
// (checkout locker, shipping-line phone, payment status).
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { upsertOrderFromWebhook } from "../models/order.server.js";

const SYNC_DAYS = 60;   // Shopify only exposes the last 60 days without read_all_orders
const MAX_PAGES = 10;   // 500 orders — keeps the request well inside the timeout

const ORDERS_QUERY = `
  query syncOrders($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        email
        phone
        createdAt
        displayFinancialStatus
        totalPriceSet { shopMoney { amount } }
        totalWeight
        customer { firstName lastName }
        shippingAddress { firstName lastName phone address1 city province zip countryCodeV2 }
        billingAddress { phone }
        shippingLines(first: 1) { nodes { code title phone } }
        customAttributes { key value }
      }
    }
  }
`;

// GraphQL order → the subset of the REST/webhook payload upsertOrderFromWebhook reads
function toWebhookPayload(o) {
  const sa = o.shippingAddress || {};
  const line = o.shippingLines?.nodes?.[0];
  return {
    id: o.id.replace("gid://shopify/Order/", ""),
    name: o.name,
    created_at: o.createdAt,
    total_price: o.totalPriceSet?.shopMoney?.amount,
    financial_status: o.displayFinancialStatus ? o.displayFinancialStatus.toLowerCase() : null,
    phone: o.phone,
    note_attributes: (o.customAttributes || []).map((a) => ({ name: a.key, value: a.value })),
    shipping_lines: line ? [line] : [],
    shipping_address: o.shippingAddress ? {
      first_name: sa.firstName, last_name: sa.lastName, phone: sa.phone, address1: sa.address1,
      city: sa.city, province: sa.province, zip: sa.zip, country_code: sa.countryCodeV2,
    } : null,
    billing_address: o.billingAddress,
    customer: { first_name: o.customer?.firstName, email: o.email },
    line_items: [{ grams: Number(o.totalWeight) || 0, quantity: 1 }],
  };
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const since = new Date(Date.now() - SYNC_DAYS * 864e5).toISOString().slice(0, 10);
    const orders = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await admin.graphql(ORDERS_QUERY, {
        variables: { first: 50, after: cursor, query: `status:any created_at:>=${since}` },
      });
      const body = await res.json();
      if (body?.errors?.length) {
        const err = body.errors.map((e) => e.message).join("; ");
        console.error("[sync-orders] Shopify GraphQL errors:", err);
        return json({ error: `Shopify: ${err}` }, { status: 502 });
      }
      const data = body?.data?.orders;
      if (!data) break;
      orders.push(...data.nodes);
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }

    let synced = 0;
    for (const o of orders) {
      const payload = toWebhookPayload(o);
      const existing = await prisma.order.findUnique({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: payload.id } },
        select: { id: true, awbStatus: true },
      });
      // Shipping data is frozen once an AWB exists; only the payment status can change
      if (existing && existing.awbStatus !== "pending") {
        await prisma.order.update({ where: { id: existing.id }, data: { financialStatus: payload.financial_status } });
      } else {
        await upsertOrderFromWebhook(shop, payload);
      }
      synced++;
    }

    console.log("[sync-orders] synced:", synced, "for", shop);
    return json({ success: true, synced, total: orders.length });
  } catch (e) {
    console.error("[sync-orders] error for shop", shop, ":", e?.message || e);
    return json({ error: e?.message || "Sync failed" }, { status: 500 });
  }
}
