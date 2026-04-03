// app/routes/carrier-service.js
// Shopify Carrier Service callback — called by Shopify checkout to get shipping rates.

import { createHmac } from "crypto";
import { prisma } from "../db.server.js";

function verifyHmac(body, hmacHeader) {
  if (!hmacHeader) return true; // allow during dev if header missing
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const hash = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return hash === hmacHeader;
}

export async function action({ request }) {
  const hmacHeader = request.headers.get("X-Shopify-Hmac-SHA256");
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain") || "";
  const body = await request.text();

  if (!verifyHmac(body, hmacHeader)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let data;
  try { data = JSON.parse(body); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Load per-shop fee settings
  let fees = { fanHome: 0, fanPickup: 0, samedayHome: 0, samedayPickup: 0 };
  if (shopDomain) {
    try {
      const s = await prisma.shopSettings.findUnique({ where: { shop: shopDomain } });
      if (s) {
        fees.fanHome     = s.fanHomeDeliveryFee     || 0;
        fees.fanPickup   = s.fanPickupFee           || 0;
        fees.samedayHome = s.samedayHomeDeliveryFee || 0;
        fees.samedayPickup = s.samedayPickupFee     || 0;
      }
    } catch (_) {}
  }

  const rate     = data.rate || {};
  const currency = rate.currency || "RON";

  const attrs = {};
  (rate.cart_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

  const method    = attrs["_rc_method"]        || attrs["_rocourier_method"]        || "";
  const courier   = attrs["_rc_courier"]       || attrs["_rocourier_courier"]       || "";
  const pointName = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || "";
  const pointAddr = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || "";

  const rates = buildRates({ method, courier, pointName, pointAddr, currency, fees });

  return Response.json({ rates });
}

// Convert RON float → cents string (Shopify expects price in subunits)
function toCents(ron) {
  return String(Math.round((parseFloat(ron) || 0) * 100));
}

function buildRates({ method, courier, pointName, pointAddr, currency, fees }) {
  if (method === "pickup_point" && pointName) {
    if (courier === "fan") {
      return [{
        service_name: `FANbox — ${pointName}`,
        service_code: "RC_FANBOX",
        total_price: toCents(fees.fanPickup),
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
        total_price: toCents(fees.samedayPickup),
        currency,
        description: pointAddr || "Ridicare din locker Sameday",
        min_delivery_date: deliveryDate(1),
        max_delivery_date: deliveryDate(2),
      }];
    }
  }

  if (method === "home_delivery") {
    if (courier === "fan") {
      return [{
        service_name: "FAN Courier — Livrare la domiciliu",
        service_code: "RC_FAN_HOME",
        total_price: toCents(fees.fanHome),
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
        total_price: toCents(fees.samedayHome),
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
      total_price: toCents(fees.fanHome),
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(3),
    },
    {
      service_name: "FANbox — Ridicare din locker",
      service_code: "RC_FANBOX",
      total_price: toCents(fees.fanPickup),
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(2),
    },
    {
      service_name: "Sameday — Livrare la domiciliu",
      service_code: "RC_SAMEDAY_HOME",
      total_price: toCents(fees.samedayHome),
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(3),
    },
    {
      service_name: "Sameday easybox — Ridicare din locker",
      service_code: "RC_EASYBOX",
      total_price: toCents(fees.samedayPickup),
      currency,
      min_delivery_date: deliveryDate(1),
      max_delivery_date: deliveryDate(2),
    },
  ];
}

function deliveryDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
