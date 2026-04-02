// app/routes/carrier-service.js
// Shopify Carrier Service callback — called by Shopify checkout to get shipping rates.
// Shopify docs: https://shopify.dev/docs/apps/fulfillment/shipping-apps/rates
//
// Reads cart attributes set by the RoCourier widget to return the selected
// delivery method as a shipping rate (with the pickup point name embedded).

import { createHmac } from "crypto";
import { prisma } from "../db.server.js";

// Shopify sends this header so we can verify the request is genuine
function verifyHmac(body, hmacHeader) {
  if (!hmacHeader) return true; // allow during dev if header missing
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const hash = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return hash === hmacHeader;
}

export async function action({ request }) {
  const hmacHeader = request.headers.get("X-Shopify-Hmac-SHA256");
  const body = await request.text();

  if (!verifyHmac(body, hmacHeader)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let data;
  try { data = JSON.parse(body); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const rate    = data.rate || {};
  const currency = rate.currency || "RON";

  // Read cart attributes (support both old and new key names)
  const attrs = {};
  (rate.cart_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

  const method    = attrs["_rc_method"]       || attrs["_rocourier_method"]       || "";
  const courier   = attrs["_rc_courier"]      || attrs["_rocourier_courier"]      || "";
  const pointName = attrs["_rc_point_name"]   || attrs["_rocourier_point_name"]   || "";
  const pointAddr = attrs["_rc_point_address"]|| attrs["_rocourier_point_address"]|| "";

  // Look up per-shop settings to know which couriers are enabled
  const shop = rate.destination?.country === "RO"
    ? null  // we don't have shop domain from this request — show all by default
    : null;

  const rates = buildRates({ method, courier, pointName, pointAddr, currency });

  return Response.json({ rates });
}

function buildRates({ method, courier, pointName, pointAddr, currency }) {
  // Pickup point selected
  if (method === "pickup_point" && pointName) {
    if (courier === "fan") {
      return [{
        service_name: `FANbox — ${pointName}`,
        service_code: "RC_FANBOX",
        total_price: "0",
        currency,
        description: pointAddr || "Ridicare din locker FAN Courier",
        min_delivery_date: deliveryDate(1),
        max_delivery_date: deliveryDate(2),
      }];
    }
    if (courier === "sameday") {
      return [{
        service_name: `Sameday easybox — ${pointName}`,
        service_code: "RC_EASYBOX",
        total_price: "0",
        currency,
        description: pointAddr || "Ridicare din locker Sameday",
        min_delivery_date: deliveryDate(1),
        max_delivery_date: deliveryDate(2),
      }];
    }
  }

  // Home delivery selected
  if (method === "home_delivery") {
    if (courier === "fan") {
      return [{
        service_name: "FAN Courier — Livrare la domiciliu",
        service_code: "RC_FAN_HOME",
        total_price: "0",
        currency,
        description: "Livrare standard FAN Courier",
        min_delivery_date: deliveryDate(1),
        max_delivery_date: deliveryDate(3),
      }];
    }
    if (courier === "sameday") {
      return [{
        service_name: "Sameday — Livrare la domiciliu",
        service_code: "RC_SAMEDAY_HOME",
        total_price: "0",
        currency,
        description: "Livrare standard Sameday",
        min_delivery_date: deliveryDate(1),
        max_delivery_date: deliveryDate(3),
      }];
    }
  }

  // Nothing selected yet — return all 4 options so checkout isn't blocked
  return [
    {
      service_name: "FAN Courier — Livrare la domiciliu",
      service_code: "RC_FAN_HOME",
      total_price: "0",
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(3),
    },
    {
      service_name: "FANbox — Ridicare din locker",
      service_code: "RC_FANBOX",
      total_price: "0",
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(2),
    },
    {
      service_name: "Sameday — Livrare la domiciliu",
      service_code: "RC_SAMEDAY_HOME",
      total_price: "0",
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(3),
    },
    {
      service_name: "Sameday easybox — Ridicare din locker",
      service_code: "RC_EASYBOX",
      total_price: "0",
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(2),
    },
  ];
}

function deliveryDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  // Skip weekends
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
