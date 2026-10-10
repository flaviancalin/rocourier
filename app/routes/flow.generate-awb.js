// app/routes/flow.generate-awb.js
// Shopify Flow action "Generate AWB with Picklo" (extensions/picklo-flow-generate-awb).
// Flow signs the JSON body with the app secret (x-shopify-hmac-sha256).
import crypto from "node:crypto";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { generateAwbForOrder } from "../services/awb.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

export const loader = () => new Response("Method Not Allowed", { status: 405 });

function validHmac(raw, header) {
  if (!header || !process.env.SHOPIFY_API_SECRET) return false;
  const digest = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(raw, "utf8").digest("base64");
  const a = Buffer.from(digest), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function action({ request }) {
  const raw = await request.text();
  if (!validHmac(raw, request.headers.get("x-shopify-hmac-sha256"))) return json({ message: "Invalid signature" }, { status: 401 });

  const body = JSON.parse(raw);
  if (body.handle && body.handle !== "picklo-generate-awb") return json({ message: "Unknown action" }, { status: 400 });
  const shop = body.shopify_domain;
  const props = body.properties || {};
  const shopifyOrderId = String(props.order_id || "").split("/").pop();

  const order = await prisma.order.findFirst({ where: { shop, shopifyOrderId } });
  if (!order) return json({ message: "Picklo nu are această comandă încă. Rulează acțiunea după crearea comenzii." }, { status: 404 });
  if (order.awbNumber) return json({ message: `Comanda are deja AWB ${order.awbNumber}` }, { status: 200 });

  const courier = String(props.courier || "").trim().toLowerCase() || undefined;
  if (courier && !COURIER_LABELS[courier]) return json({ message: `Curier necunoscut: ${courier}` }, { status: 400 });

  try {
    const { admin } = await unauthenticated.admin(shop);
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    const { awbNumber } = await generateAwbForOrder(admin, shop, order.id, {
      courierOverride: courier,
      markAsDispatched: props["mark as shipped"] === true || props["mark as shipped"] === "true",
      notifyCustomer: !!settings?.autoAwbNotifyCustomer,
      actor: "Shopify Flow",
    });
    return json({ message: `AWB ${awbNumber} generat` }, { status: 200 });
  } catch (e) {
    // Courier rejections are merchant-fixable (address, phone…): don't retry
    return json({ message: e.message }, { status: e.status && e.status < 500 ? e.status : 422 });
  }
}
