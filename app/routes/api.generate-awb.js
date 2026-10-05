// app/routes/api.generate-awb.js
// Called from the admin dashboard (AWB wizard) to generate an AWB for an order
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { generateAwbForOrder } from "../services/awb.server.js";

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { orderId, ...options } = await request.json();
  try {
    const { awbNumber, order } = await generateAwbForOrder(admin, session.shop, orderId, options);
    return json({ success: true, awbNumber, order });
  } catch (e) {
    console.error("AWB generation error:", e);
    return json({ error: e.message, ...(e.extra || {}) }, { status: e.status || 500 });
  }
}
