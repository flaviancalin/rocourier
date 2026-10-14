// app/routes/api.generate-awb.js
// Called from the admin dashboard (AWB wizard) to generate an AWB for an order
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { generateAwbForOrder } from "../services/awb.server.js";
import { prisma } from "../db.server.js";
import { chooseCourier } from "../services/courier-choice.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { orderId, ...options } = await request.json();
  try {
    const actor = session.onlineAccessInfo?.associated_user?.email || "staff";
    // Bulk generation without a wizard: courier rules, then the automatic (cheapest) choice
    if (options.useRules && !options.courierOverride) {
      const [order, settings] = await Promise.all([
        prisma.order.findFirst({ where: { shop: session.shop, id: orderId } }),
        prisma.shopSettings.findUnique({ where: { shop: session.shop } }),
      ]);
      if (order && settings) {
        const choice = await chooseCourier(settings, order).catch(() => ({}));
        options.courierOverride = choice.courier || undefined;
        if (choice.reason) options.courierReason = choice.reason;
      }
    }
    delete options.useRules;
    const { awbNumber, order } = await generateAwbForOrder(admin, session.shop, orderId, { ...options, actor });
    return json({ success: true, awbNumber, order });
  } catch (e) {
    console.error("AWB generation error:", e);
    return json({ error: e.message, ...(e.extra || {}) }, { status: e.status || 500 });
  }
}
