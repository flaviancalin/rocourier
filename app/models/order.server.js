// app/models/order.server.js
import { prisma } from "../db.server.js";

// ─────────────────────────────────────────────────────────────────────────────
// Upsert order from Shopify webhook payload
// ─────────────────────────────────────────────────────────────────────────────
export async function upsertOrderFromWebhook(shop, shopifyOrder) {
  const attrs = (shopifyOrder.note_attributes || []).reduce((acc, a) => {
    acc[a.name] = a.value;
    return acc;
  }, {});

  const data = {
    shopifyOrderName: shopifyOrder.name,
    customerName: [
      shopifyOrder.shipping_address?.first_name,
      shopifyOrder.shipping_address?.last_name,
    ].filter(Boolean).join(" ") || shopifyOrder.customer?.first_name || "Unknown",
    customerPhone: shopifyOrder.shipping_address?.phone || shopifyOrder.customer?.phone || "",
    customerEmail: shopifyOrder.customer?.email || "",
    shippingAddress1: shopifyOrder.shipping_address?.address1 || "",
    shippingCity: shopifyOrder.shipping_address?.city || "",
    shippingCounty: shopifyOrder.shipping_address?.province || "",
    shippingZip: shopifyOrder.shipping_address?.zip || "",
    shippingCountry: shopifyOrder.shipping_address?.country_code || "RO",
    shippingMethod: attrs["_rocourier_method"] || "home_delivery",
    courierType: attrs["_rocourier_courier"] || "fan",
    pickupPointId: attrs["_rocourier_point_id"] || null,
    pickupPointName: attrs["_rocourier_point_name"] || null,
    codAmount: parseFloat(shopifyOrder.total_price) || 0,
    orderTotal: parseFloat(shopifyOrder.total_price) || 0,
    awbStatus: "pending",
    shopifyCreatedAt: new Date(shopifyOrder.created_at),
  };

  return prisma.order.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(shopifyOrder.id) } },
    update: {
      shippingMethod: data.shippingMethod,
      courierType: data.courierType,
      pickupPointId: data.pickupPointId,
      pickupPointName: data.pickupPointName,
      codAmount: data.codAmount,
    },
    create: { shop, shopifyOrderId: String(shopifyOrder.id), ...data },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get paginated orders list for dashboard
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrders({
  shop,
  page = 1,
  perPage = 25,
  status = null,
  courier = null,
  method = null,
  search = null,
}) {
  const where = {
    shop,
    ...(status ? { awbStatus: status } : {}),
    ...(courier ? { courierType: courier } : {}),
    ...(method ? { shippingMethod: method } : {}),
    ...(search
      ? {
          OR: [
            { shopifyOrderName: { contains: search, mode: "insensitive" } },
            { customerName: { contains: search, mode: "insensitive" } },
            { awbNumber: { contains: search } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { events: { orderBy: { eventDate: "desc" }, take: 1 } },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────
export async function getDashboardStats(shop) {
  const [byStatus, byCourier, byMethod, recentCod] = await Promise.all([
    prisma.order.groupBy({
      by: ["awbStatus"],
      where: { shop },
      _count: true,
    }),
    prisma.order.groupBy({
      by: ["courierType"],
      where: { shop },
      _count: true,
    }),
    prisma.order.groupBy({
      by: ["shippingMethod"],
      where: { shop },
      _count: true,
    }),
    prisma.order.aggregate({
      where: { shop, codAmount: { gt: 0 }, awbStatus: "pending" },
      _sum: { codAmount: true },
      _count: true,
    }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((s) => [s.awbStatus, s._count])),
    byCourier: Object.fromEntries(byCourier.map((c) => [c.courierType, c._count])),
    byMethod: Object.fromEntries(byMethod.map((m) => [m.shippingMethod, m._count])),
    pendingCodTotal: recentCod._sum.codAmount || 0,
    pendingCodCount: recentCod._count,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update AWB data after generation
// ─────────────────────────────────────────────────────────────────────────────
export async function updateOrderAwb(id, { awbNumber, awbPdfUrl, awbStatus = "generated" }) {
  return prisma.order.update({
    where: { id },
    data: { awbNumber, awbPdfUrl, awbStatus, updatedAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Log tracking event
// ─────────────────────────────────────────────────────────────────────────────
export async function addTrackingEvent(orderId, { code, description, date, location }) {
  return prisma.awbEvent.upsert({
    where: {
      // Use composite unique — but since AwbEvent doesn't have @@unique, use create/ignore pattern
      id: `${orderId}_${code}_${date}`,
    },
    update: { eventDesc: description, location },
    create: {
      id: `${orderId}_${code}_${new Date(date).getTime()}`,
      orderId,
      eventCode: code,
      eventDesc: description,
      eventDate: new Date(date),
      location,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get single order with events
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrder(shop, id) {
  return prisma.order.findFirst({
    where: { shop, id },
    include: { events: { orderBy: { eventDate: "desc" } } },
  });
}
