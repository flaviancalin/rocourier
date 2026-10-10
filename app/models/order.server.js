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

  // Support both _rc_ (current widget) and _rocourier_ (legacy) attribute prefixes
  let rcMethod      = attrs["_rc_method"]        || attrs["_rocourier_method"]        || null;
  let rcCourier     = attrs["_rc_courier"]       || attrs["_rocourier_courier"]       || null;
  let rcPointId     = attrs["_rc_point_id"]      || attrs["_rocourier_point_id"]      || null;
  let rcPointName   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
  let rcPointAddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

  // The rate the shopper picked at checkout wins over the cart widget: with
  // carrier-calculated shipping they can choose a different locker in checkout.
  const fromRate = parseShippingCode(shopifyOrder.shipping_lines?.[0]?.code);
  if (fromRate) {
    rcMethod  = fromRate.method;
    rcCourier = fromRate.courier;
    if (fromRate.pointId && fromRate.pointId !== rcPointId) {
      const point = await prisma.pickupPoint.findFirst({
        where: { courier: fromRate.courier, externalId: fromRate.pointId },
        select: { name: true, address: true },
      });
      rcPointId   = fromRate.pointId;
      rcPointName = point?.name || shopifyOrder.shipping_lines[0].title || fromRate.pointId;
      rcPointAddr = point?.address || null;
    }
    if (fromRate.method === "home_delivery") rcPointId = rcPointName = rcPointAddr = null;
  }
  rcMethod  = rcMethod  || "home_delivery";
  rcCourier = rcCourier || "fan";

  // Cash on delivery = what the customer still owes. Orders paid online must never get a
  // COD amount on the AWB, or the courier would collect the money a second time.
  const codAmount = codAmountFor(shopifyOrder);
  const company = shopifyOrder.billing_address?.company || shopifyOrder.shipping_address?.company || "";
  const vatAttr = Object.entries(attrs).find(([k]) => /^(cui|cif|vat|vat_number|cod fiscal|picklo_cui)$/i.test(k))?.[1] || "";

  const weightKg = (shopifyOrder.line_items || []).reduce(
    (sum, item) => sum + (item.grams || 0) * (item.quantity || 1), 0
  ) / 1000;

  const data = {
    shopifyOrderName: shopifyOrder.name,
    customerName: [
      shopifyOrder.shipping_address?.first_name,
      shopifyOrder.shipping_address?.last_name,
    ].filter(Boolean).join(" ") || shopifyOrder.customer?.first_name || "Unknown",
    // Rates with phone_required put the checkout phone on the shipping line, not the address
    customerPhone: shopifyOrder.shipping_address?.phone || shopifyOrder.shipping_lines?.[0]?.phone
      || shopifyOrder.billing_address?.phone || shopifyOrder.phone || shopifyOrder.customer?.phone || "",
    customerEmail: shopifyOrder.customer?.email || "",
    shippingAddress1: shopifyOrder.shipping_address?.address1 || "",
    shippingCity: shopifyOrder.shipping_address?.city || "",
    shippingCounty: shopifyOrder.shipping_address?.province || "",
    shippingZip: shopifyOrder.shipping_address?.zip || "",
    shippingCountry: shopifyOrder.shipping_address?.country_code || "RO",
    shippingMethod: rcMethod,
    courierType: rcCourier,
    pickupPointId: rcPointId,
    pickupPointName: rcPointName,
    pickupPointAddress: rcPointAddr,
    codAmount,
    orderTotal: parseFloat(shopifyOrder.total_price) || 0,
    customerCompany: company || null,
    customerVatCode: vatAttr ? String(vatAttr).replace(/\s/g, "").toUpperCase() : null,
    weight: weightKg > 0 ? weightKg : undefined,
    awbStatus: "pending",
    financialStatus: shopifyOrder.financial_status || null,
    shopifyCreatedAt: new Date(shopifyOrder.created_at),
  };

  return prisma.order.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(shopifyOrder.id) } },
    update: {
      shippingMethod: data.shippingMethod,
      courierType: data.courierType,
      pickupPointId: data.pickupPointId,
      pickupPointName: data.pickupPointName,
      pickupPointAddress: data.pickupPointAddress,
      codAmount: data.codAmount,
      financialStatus: data.financialStatus,
      customerCompany: data.customerCompany,
      customerVatCode: data.customerVatCode,
      ...(weightKg > 0 ? { weight: weightKg } : {}),
    },
    create: { shop, shopifyOrderId: String(shopifyOrder.id), ...data },
  });
}

const PAID_STATUSES = new Set(["paid", "partially_refunded", "refunded", "voided"]);
export function codAmountFor(shopifyOrder) {
  if (PAID_STATUSES.has(shopifyOrder.financial_status)) return 0;
  const outstanding = Number.parseFloat(shopifyOrder.total_outstanding);
  if (Number.isFinite(outstanding)) return Math.max(0, outstanding);
  return Number.parseFloat(shopifyOrder.total_price) || 0;
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
export async function updateOrderAwb(id, { awbNumber, awbPdfUrl, awbStatus = "generated", courierType }) {
  return prisma.order.update({
    where: { id },
    data: {
      awbNumber,
      awbPdfUrl,
      awbStatus,
      updatedAt: new Date(),
      ...(courierType ? { courierType } : {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Log tracking event
// ─────────────────────────────────────────────────────────────────────────────
export async function addTrackingEvent(orderId, { code, description, date, location }) {
  // Deterministic id = one row per courier event, however often we poll
  const id = `${orderId}_${code}_${new Date(date).getTime()}`;
  return prisma.awbEvent.upsert({
    where: { id },
    update: { eventDesc: description, location },
    create: {
      id,
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

// RC_PP_<courier>_<pointId> → pickup point · RC_<COURIER>_HOME → home delivery
// RC_<COURIER>_POINT / legacy RC_FANBOX… → pickup point without a specific point
const LEGACY_POINT_CODES = {
  RC_FANBOX: "fan", RC_EASYBOX: "sameday", RC_CARGUS_PUDO: "cargus",
  RC_GLS_PARCELSHOP: "gls", RC_PACKETA_POINT: "packeta",
};
export function parseShippingCode(code) {
  if (!code || !String(code).startsWith("RC_")) return null;
  const pp = /^RC_PP_([a-z]+)_(.+)$/.exec(code);
  if (pp) return { method: "pickup_point", courier: pp[1], pointId: pp[2] };
  const home = /^RC_([A-Z]+)_HOME$/.exec(code);
  if (home) return { method: "home_delivery", courier: home[1].toLowerCase() };
  const point = /^RC_([A-Z]+)_POINT$/.exec(code);
  if (point) return { method: "pickup_point", courier: point[1].toLowerCase() };
  if (LEGACY_POINT_CODES[code]) return { method: "pickup_point", courier: LEGACY_POINT_CODES[code] };
  return null;
}
