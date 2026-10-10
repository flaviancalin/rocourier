// app/services/analytics.server.js
// Delivery performance per courier for a period: delivery / refusal rates, delivery
// time, shipping cost, pickup-point usage.
import { prisma } from "../db.server.js";

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function summarize(orders) {
  const byCourier = {};
  const lockers = {};
  let pickup = 0, cod = 0;
  for (const o of orders) {
    const c = (byCourier[o.courierType] ||= { courier: o.courierType, shipped: 0, delivered: 0, returned: 0, failed: 0, inProgress: 0, days: [], cost: 0, costCount: 0, sales: 0 });
    c.shipped++;
    c.sales += o.orderTotal || 0;
    if (o.awbStatus === "delivered") {
      c.delivered++;
      if (o.deliveredAt) c.days.push((new Date(o.deliveredAt) - new Date(o.createdAt)) / 864e5);
    } else if (o.awbStatus === "returned") c.returned++;
    else if (o.awbStatus === "failed") c.failed++;
    else c.inProgress++;
    if (o.shippingCost != null) { c.cost += o.shippingCost; c.costCount++; }
    if (o.shippingMethod === "pickup_point") {
      pickup++;
      if (o.pickupPointName) lockers[o.pickupPointName] = (lockers[o.pickupPointName] || 0) + 1;
    }
    if (o.codAmount > 0) cod++;
  }
  const couriers = Object.values(byCourier).map((c) => {
    const closed = c.delivered + c.returned + c.failed;
    return {
      courier: c.courier, shipped: c.shipped, delivered: c.delivered, returned: c.returned, failed: c.failed, inProgress: c.inProgress,
      deliveryRate: closed ? round((c.delivered / closed) * 100) : null,
      returnRate: closed ? round((c.returned / closed) * 100) : null,
      avgDays: c.days.length ? round(c.days.reduce((a, b) => a + b, 0) / c.days.length) : null,
      avgCost: c.costCount ? round(c.cost / c.costCount, 2) : null,
      costShare: c.costCount && c.sales ? round((c.cost / c.sales) * 100) : null,
    };
  }).sort((a, b) => b.shipped - a.shipped);
  return {
    total: orders.length,
    pickupShare: orders.length ? round((pickup / orders.length) * 100) : 0,
    codShare: orders.length ? round((cod / orders.length) * 100) : 0,
    couriers,
    topLockers: Object.entries(lockers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
  };
}

export async function deliveryReport(shop, days = 30) {
  const since = new Date(Date.now() - days * 864e5);
  const orders = await prisma.order.findMany({
    where: { shop, awbNumber: { not: null }, createdAt: { gte: since } },
    select: { courierType: true, awbStatus: true, createdAt: true, deliveredAt: true, shippingCost: true, orderTotal: true, shippingMethod: true, pickupPointName: true, codAmount: true },
  });
  return { days, ...summarize(orders) };
}
