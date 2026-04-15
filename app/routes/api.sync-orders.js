// app/routes/api.sync-orders.js
// Manually sync orders from Shopify API into the local DB
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop  = session.shop;
  const token = session.accessToken;

  if (!shop || !token) return json({ error: "Cannot determine shop" }, { status: 400 });

  // Use raw fetch with the offline access token — dev stores don't need
  // Protected Customer Data approval for the REST API
  let shopifyOrders = [];
  try {
    const FIELDS = "id,name,created_at,note_attributes,shipping_address,customer,total_price,line_items";
    let nextUrl = `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&fields=${FIELDS}`;

    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: { "X-Shopify-Access-Token": token } });

      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status));
        return json({ error: `Shopify API error ${res.status}: ${text}` }, { status: 502 });
      }

      const body = await res.json();
      shopifyOrders.push(...(body.orders || []));

      // Follow Shopify pagination via Link header
      const link = res.headers.get("Link") || "";
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = nextMatch ? nextMatch[1] : null;
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return json({ error: e?.message || "Network error" }, { status: 500 });
  }

  let upserted = 0;
  for (const o of shopifyOrders) {
    const attrs = {};
    (o.note_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

    const method  = attrs["_rc_method"]   || attrs["_rocourier_method"]   || "home_delivery";
    const courier = attrs["_rc_courier"]  || attrs["_rocourier_courier"]  || "fan";
    const pid     = attrs["_rc_point_id"] || attrs["_rocourier_point_id"] || null;
    const pname   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
    const paddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

    const sa = o.shipping_address || {};
    const weightKg = (o.line_items || []).reduce(
      (sum, item) => sum + (item.grams || 0) * (item.quantity || 1), 0
    ) / 1000;

    const data = {
      shopifyOrderName:   o.name,
      customerName:       [sa.first_name, sa.last_name].filter(Boolean).join(" ") || o.customer?.first_name || "Unknown",
      customerPhone:      sa.phone || o.customer?.phone || "",
      customerEmail:      o.customer?.email || "",
      shippingAddress1:   sa.address1 || "",
      shippingCity:       sa.city || "",
      shippingCounty:     sa.province || "",
      shippingZip:        sa.zip || "",
      shippingCountry:    sa.country_code || "RO",
      shippingMethod:     method,
      courierType:        courier,
      pickupPointId:      pid,
      pickupPointName:    pname,
      pickupPointAddress: paddr,
      codAmount:          parseFloat(o.total_price) || 0,
      orderTotal:         parseFloat(o.total_price) || 0,
      weight:             weightKg > 0 ? weightKg : undefined,
      shopifyCreatedAt:   new Date(o.created_at),
    };

    // Always update customer/address data
    await prisma.order.upsert({
      where:  { shop_shopifyOrderId: { shop, shopifyOrderId: String(o.id) } },
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
      create: { shop, shopifyOrderId: String(o.id), awbStatus: "pending", ...data },
    });

    // Only update courier/method/pickup for orders that don't have an AWB yet.
    // Once an AWB is generated the courier is locked — syncing Shopify must not overwrite it.
    await prisma.order.updateMany({
      where: { shop, shopifyOrderId: String(o.id), awbStatus: "pending" },
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

  console.log("[sync-orders] synced:", upserted, "of", shopifyOrders.length);
  return json({ success: true, synced: upserted, total: shopifyOrders.length });
}
