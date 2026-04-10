// app/routes/api.sync-orders.js
// Manually sync orders from Shopify API into the local DB
// Called from the orders page to force a refresh
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  let shop = session.shop;
  const token = session.accessToken;

  if (!shop && token) {
    const found = await prisma.session.findFirst({ where: { accessToken: token } });
    if (found) shop = found.shop;
  }

  if (!shop) return json({ error: "Cannot determine shop" }, { status: 400 });
  if (!token) return json({ error: "No access token" }, { status: 400 });

  try {
    // Fetch last 250 orders from Shopify (max per page)
    const res = await fetch(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&fields=id,name,created_at,note_attributes,shipping_address,customer,total_price`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Shopify API error [${res.status}]: ${text.slice(0, 300)}` }, { status: 502 });
    }

    const { orders: shopifyOrders } = await res.json();
    if (!shopifyOrders) return json({ error: "No orders array in Shopify response" }, { status: 502 });

    let upserted = 0;
    for (const o of shopifyOrders) {
      const attrs = {};
      (o.note_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

      const method  = attrs["_rc_method"]   || attrs["_rocourier_method"]   || "home_delivery";
      const courier = attrs["_rc_courier"]  || attrs["_rocourier_courier"]  || "fan";
      const pid     = attrs["_rc_point_id"] || attrs["_rocourier_point_id"] || null;
      const pname   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
      const paddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

      const data = {
        shopifyOrderName:   o.name,
        customerName:       [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(" ") || o.customer?.first_name || "Unknown",
        customerPhone:      o.shipping_address?.phone || o.customer?.phone || "",
        customerEmail:      o.customer?.email || "",
        shippingAddress1:   o.shipping_address?.address1 || "",
        shippingCity:       o.shipping_address?.city || "",
        shippingCounty:     o.shipping_address?.province || "",
        shippingZip:        o.shipping_address?.zip || "",
        shippingCountry:    o.shipping_address?.country_code || "RO",
        shippingMethod:     method,
        courierType:        courier,
        pickupPointId:      pid,
        pickupPointName:    pname,
        pickupPointAddress: paddr,
        codAmount:          parseFloat(o.total_price) || 0,
        orderTotal:         parseFloat(o.total_price) || 0,
        shopifyCreatedAt:   new Date(o.created_at),
      };

      await prisma.order.upsert({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(o.id) } },
        update: {
          shopifyOrderName:   data.shopifyOrderName,
          customerName:       data.customerName,
          customerPhone:      data.customerPhone,
          customerEmail:      data.customerEmail,
          shippingAddress1:   data.shippingAddress1,
          shippingCity:       data.shippingCity,
          shippingCounty:     data.shippingCounty,
          shippingZip:        data.shippingZip,
          shippingMethod:     data.shippingMethod,
          courierType:        data.courierType,
          pickupPointId:      data.pickupPointId,
          pickupPointName:    data.pickupPointName,
          pickupPointAddress: data.pickupPointAddress,
          codAmount:          data.codAmount,
          orderTotal:         data.orderTotal,
        },
        create: { shop, shopifyOrderId: String(o.id), awbStatus: "pending", ...data },
      });
      upserted++;
    }

    return json({ success: true, synced: upserted, total: shopifyOrders.length });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}
