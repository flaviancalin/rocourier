// app/routes/api.compare-rates.js — courier price comparison for one order (AWB wizard / order page)
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { compareRates } from "../services/rates-compare.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const orderId = new URL(request.url).searchParams.get("orderId");
  const [order, settings] = await Promise.all([
    prisma.order.findFirst({ where: { shop: session.shop, id: orderId } }),
    prisma.shopSettings.findUnique({ where: { shop: session.shop } }),
  ]);
  if (!order || !settings) return json({ rates: [] }, { status: 404 });
  return json({ rates: await compareRates(settings, order) });
}
