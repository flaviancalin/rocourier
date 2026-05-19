// app/routes/api.sync-orders.js
// Manually sync orders from Shopify Admin GraphQL API into the local DB
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const ORDERS_QUERY = `
  query syncOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "status:any") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet { shopMoney { amount } }
          customer { email phone firstName lastName }
          shippingAddress {
            firstName lastName phone address1
            city province zip countryCode
          }
          lineItems(first: 50) {
            edges {
              node {
                quantity
                variant { weight weightUnit }
              }
            }
          }
          customAttributes { key value }
        }
      }
    }
  }
`;

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let allOrders = [];
  let cursor    = null;
  let hasNext   = true;

  while (hasNext) {
    const res  = await admin.graphql(ORDERS_QUERY, { variables: { first: 50, after: cursor } });
    const body = await res.json();
    const page = body?.data?.orders;
    if (!page) {
      const err = body?.errors?.[0]?.message || JSON.stringify(body);
      return json({ error: `Shopify GraphQL error: ${err}` }, { status: 502 });
    }
    allOrders.push(...page.edges.map((e) => e.node));
    hasNext = page.pageInfo.hasNextPage;
    cursor  = page.pageInfo.endCursor;
  }

  let upserted = 0;
  for (const o of allOrders) {
    const attrs = {};
    (o.customAttributes || []).forEach((a) => { attrs[a.key] = a.value; });

    const method  = attrs["_rc_method"]   || attrs["_rocourier_method"]   || "home_delivery";
    const courier = attrs["_rc_courier"]  || attrs["_rocourier_courier"]  || "fan";
    const pid     = attrs["_rc_point_id"] || attrs["_rocourier_point_id"] || null;
    const pname   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
    const paddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

    const sa = o.shippingAddress || {};

    // Weight: convert all units to kg
    const weightKg = (o.lineItems?.edges || []).reduce((sum, { node: item }) => {
      const w    = item.variant?.weight || 0;
      const unit = item.variant?.weightUnit || "KILOGRAMS";
      const kg   = unit === "GRAMS" ? w / 1000 :
                   unit === "POUNDS" ? w * 0.453592 :
                   unit === "OUNCES" ? w * 0.028350 : w;
      return sum + kg * (item.quantity || 1);
    }, 0);

    // Strip GID prefix → plain numeric ID
    const shopifyOrderId = o.id.replace("gid://shopify/Order/", "");

    const customerName =
      [sa.firstName, sa.lastName].filter(Boolean).join(" ") ||
      [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") ||
      "Unknown";

    const data = {
      shopifyOrderName:   o.name,
      customerName,
      customerPhone:      sa.phone || o.customer?.phone || "",
      customerEmail:      o.customer?.email || "",
      shippingAddress1:   sa.address1 || "",
      shippingCity:       sa.city || "",
      shippingCounty:     sa.province || "",
      shippingZip:        sa.zip || "",
      shippingCountry:    sa.countryCode || "RO",
      shippingMethod:     method,
      courierType:        courier,
      pickupPointId:      pid,
      pickupPointName:    pname,
      pickupPointAddress: paddr,
      codAmount:          parseFloat(o.totalPriceSet?.shopMoney?.amount) || 0,
      orderTotal:         parseFloat(o.totalPriceSet?.shopMoney?.amount) || 0,
      weight:             weightKg > 0 ? weightKg : undefined,
      shopifyCreatedAt:   new Date(o.createdAt),
    };

    await prisma.order.upsert({
      where:  { shop_shopifyOrderId: { shop, shopifyOrderId } },
      update: {
        shopifyOrderName:   data.shopifyOrderName,
        customerName:       data.customerName,
        customerPhone:      data.customerPhone,
        customerEmail:      data.customerEmail,
        shippingAddress1:   data.shippingAddress1,
        shippingCity:       data.shippingCity,
        shippingCounty:     data.shippingCounty,
        shippingZip:        data.shippingZip,
        codAmount:          data.codAmount,
        orderTotal:         data.orderTotal,
        ...(weightKg > 0 ? { weight: weightKg } : {}),
      },
      create: { shop, shopifyOrderId, awbStatus: "pending", ...data },
    });

    await prisma.order.updateMany({
      where: { shop, shopifyOrderId, awbStatus: "pending" },
      data: {
        shippingMethod:     data.shippingMethod,
        courierType:        data.courierType,
        pickupPointId:      data.pickupPointId,
        pickupPointName:    data.pickupPointName,
        pickupPointAddress: data.pickupPointAddress,
      },
    });
    upserted++;
  }

  console.log("[sync-orders] synced:", upserted, "of", allOrders.length);
  return json({ success: true, synced: upserted, total: allOrders.length });
}
