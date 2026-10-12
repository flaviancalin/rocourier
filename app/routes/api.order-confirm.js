// app/routes/api.order-confirm.js — mark an order as confirmed (or not) by the customer,
// e.g. after the customer sent the WhatsApp confirmation message from the Thank you page.
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { logActivity } from "../services/activity.server.js";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { orderId, confirmed } = await request.json();
  if (!orderId) return json({ error: "Missing orderId" }, { status: 400 });
  const order = await prisma.order.findFirst({ where: { shop: session.shop, id: orderId } });
  if (!order) return json({ error: "Order not found" }, { status: 404 });
  const customerConfirmedAt = confirmed ? new Date() : null;
  await prisma.order.update({ where: { id: order.id }, data: { customerConfirmedAt } });
  await logActivity({ shop: session.shop, order, action: confirmed ? "customer_confirmed" : "customer_unconfirmed",
    actor: session.onlineAccessInfo?.associated_user?.email || "staff",
    message: confirmed ? `Comanda ${order.shopifyOrderName} confirmată de client` : `Confirmarea comenzii ${order.shopifyOrderName} anulată` }).catch(() => {});
  return json({ success: true, customerConfirmedAt });
}
