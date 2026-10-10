// app/routes/api.delete-awb.js
// Cancel/delete a previously generated AWB (only possible before courier pickup)
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { deleteAwbForOrder } from "../services/awb.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const { orderId } = await request.json();
  if (!orderId) return json({ error: "Missing orderId" }, { status: 400 });

  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  if (!order) return json({ error: "Order not found" }, { status: 404 });
  if (!order.awbNumber) return json({ error: "No AWB to delete" }, { status: 400 });

  try {
    await deleteAwbForOrder(admin, order, settings, { actor: session.onlineAccessInfo?.associated_user?.email || "staff" });
    return json({ success: true });
  } catch (e) {
    console.error("Delete AWB error:", e);
    return json({ error: e.message }, { status: 500 });
  }
}
