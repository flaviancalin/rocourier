// app/routes/carrier-service.js
// Shopify Carrier Service callback (carrier-calculated shipping) — returns checkout rates.
// Rates are built in services/checkout-rates.server.js.

import { createHmac, timingSafeEqual } from "crypto";
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import { buildRates } from "../services/checkout-rates.server.js";

function verifyHmac(body, hmacHeader) {
  if (!hmacHeader) return false;
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const hash = Buffer.from(createHmac("sha256", secret).update(body, "utf8").digest("base64"));
  const given = Buffer.from(hmacHeader);
  return hash.length === given.length && timingSafeEqual(hash, given);
}

export async function action({ request }) {
  const body = await request.text();
  if (!verifyHmac(body, request.headers.get("X-Shopify-Hmac-SHA256"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let data;
  try { data = JSON.parse(body); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";
  const settings = shop ? await prisma.shopSettings.findUnique({ where: { shop } }).catch(() => null) : null;
  if (!settings) return json({ rates: [] }); // not configured — let Shopify use the store's other rates

  const rate = data.rate || {};
  const rates = await buildRates({ rate, settings });
  return json({ rates });
}

