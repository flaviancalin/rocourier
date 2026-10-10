// app/routes/api.track-awb.js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { getOrder } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { refreshOrderTracking } from "../services/tracking.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return json({ error: "Missing orderId" }, { status: 400 });

  const order    = await getOrder(session.shop, orderId);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  if (!order?.awbNumber) return json({ events: [] });

  try {
    const { events, status } = await refreshOrderTracking(order, settings, { actor: session.onlineAccessInfo?.associated_user?.email || "staff" });
    return json({ events, status });
  } catch (e) {
    console.error("Track AWB error:", e);
    return json({ events: order.events || [], error: e.message });
  }
}
