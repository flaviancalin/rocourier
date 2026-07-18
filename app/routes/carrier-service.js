// app/routes/carrier-service.js
// Shopify Carrier Service callback — called by Shopify checkout to get shipping rates.

import { createHmac } from "crypto";
import { prisma } from "../db.server.js";

function verifyHmac(body, hmacHeader) {
  if (!hmacHeader) return false;
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

  // Load per-shop settings (fees + enabled flags)
  let settings = {
    fanEnabled: true,    fanHomeDeliveryFee: 0,  fanPickupFee: 0,
    samedayEnabled: true, samedayHomeDeliveryFee: 0, samedayPickupFee: 0,
    cargusEnabled: false, cargusHomeDeliveryFee: 0,  cargusPickupFee: 0,
    glsEnabled: false,    glsHomeDeliveryFee: 0,     glsPickupFee: 0,
    packetaEnabled: false, packetaHomeDeliveryFee: 0, packetaPickupFee: 0,
  };
  if (shopDomain) {
    try {
      const s = await prisma.shopSettings.findUnique({ where: { shop: shopDomain } });
      if (s) settings = { ...settings, ...s };
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

  const rates = buildRates({ method, courier, pointName, pointAddr, currency, settings });

  return Response.json({ rates });
}

// Convert RON float → cents string (Shopify expects price in subunits)
function toCents(ron) {
  return String(Math.round((parseFloat(ron) || 0) * 100));
}

function buildRates({ method, courier, pointName, pointAddr, currency, settings }) {
  const s = settings;

  // ── Customer selected a pickup point ────────────────────────────────────────
  if (method === "pickup_point" && pointName) {
    const label = pointAddr ? `${pointName} — ${pointAddr}` : pointName;
    if (courier === "fan") return [{
      service_name: `FANbox — ${label}`,
      service_code: "RC_FANBOX",
      total_price:  toCents(s.fanPickupFee),
      currency,
      description: "Ridicare din locker FAN Courier",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    }];
    if (courier === "sameday") return [{
      service_name: `Sameday easybox — ${label}`,
      service_code: "RC_EASYBOX",
      total_price:  toCents(s.samedayPickupFee),
      currency,
      description: "Ridicare din locker Sameday",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    }];
    if (courier === "cargus") return [{
      service_name: `Cargus Ship&Go — ${label}`,
      service_code: "RC_CARGUS_PUDO",
      total_price:  toCents(s.cargusPickupFee),
      currency,
      description: "Ridicare din punct Cargus Ship&Go",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    }];
    if (courier === "gls") return [{
      service_name: `GLS ParcelShop — ${label}`,
      service_code: "RC_GLS_PARCELSHOP",
      total_price:  toCents(s.glsPickupFee),
      currency,
      description: "Ridicare din GLS ParcelShop",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    }];
    if (courier === "packeta") return [{
      service_name: `Packeta — ${label}`,
      service_code: "RC_PACKETA_POINT",
      total_price:  toCents(s.packetaPickupFee),
      currency,
      description: "Ridicare din punct Packeta / Z-Box",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    }];
  }

  // ── Customer selected home delivery ─────────────────────────────────────────
  if (method === "home_delivery") {
    if (courier === "fan") return [{
      service_name: "FAN Courier — Livrare la domiciliu",
      service_code: "RC_FAN_HOME",
      total_price:  toCents(s.fanHomeDeliveryFee),
      currency,
      description: "Livrare standard FAN Courier",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    }];
    if (courier === "sameday") return [{
      service_name: "Sameday — Livrare la domiciliu",
      service_code: "RC_SAMEDAY_HOME",
      total_price:  toCents(s.samedayHomeDeliveryFee),
      currency,
      description: "Livrare standard Sameday",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    }];
    if (courier === "cargus") return [{
      service_name: "Cargus — Livrare la domiciliu",
      service_code: "RC_CARGUS_HOME",
      total_price:  toCents(s.cargusHomeDeliveryFee),
      currency,
      description: "Livrare standard Cargus Urgent",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    }];
    if (courier === "gls") return [{
      service_name: "GLS — Livrare la domiciliu",
      service_code: "RC_GLS_HOME",
      total_price:  toCents(s.glsHomeDeliveryFee),
      currency,
      description: "Livrare standard GLS Romania",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    }];
    if (courier === "packeta") return [{
      service_name: "Packeta — Livrare la domiciliu",
      service_code: "RC_PACKETA_HOME",
      total_price:  toCents(s.packetaHomeDeliveryFee),
      currency,
      description: "Livrare standard Packeta",
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    }];
  }

  // ── No widget selection — show all rates for enabled couriers ───────────────
  const fallback = [];
  if (s.fanEnabled) {
    fallback.push({
      service_name: "FAN Courier — Livrare la domiciliu",
      service_code: "RC_FAN_HOME",
      total_price: toCents(s.fanHomeDeliveryFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
    fallback.push({
      service_name: "FANbox — Ridicare din locker",
      service_code: "RC_FANBOX",
      total_price: toCents(s.fanPickupFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    });
  }
  if (s.samedayEnabled) {
    fallback.push({
      service_name: "Sameday — Livrare la domiciliu",
      service_code: "RC_SAMEDAY_HOME",
      total_price: toCents(s.samedayHomeDeliveryFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
    fallback.push({
      service_name: "Sameday easybox — Ridicare din locker",
      service_code: "RC_EASYBOX",
      total_price: toCents(s.samedayPickupFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    });
  }
  if (s.cargusEnabled) {
    fallback.push({
      service_name: "Cargus — Livrare la domiciliu",
      service_code: "RC_CARGUS_HOME",
      total_price: toCents(s.cargusHomeDeliveryFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
    fallback.push({
      service_name: "Cargus Ship&Go — Ridicare din punct",
      service_code: "RC_CARGUS_PUDO",
      total_price: toCents(s.cargusPickupFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    });
  }
  if (s.glsEnabled) {
    fallback.push({
      service_name: "GLS — Livrare la domiciliu",
      service_code: "RC_GLS_HOME",
      total_price: toCents(s.glsHomeDeliveryFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
    fallback.push({
      service_name: "GLS ParcelShop — Ridicare din punct",
      service_code: "RC_GLS_PARCELSHOP",
      total_price: toCents(s.glsPickupFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    });
  }
  if (s.packetaEnabled) {
    fallback.push({
      service_name: "Packeta — Livrare la domiciliu",
      service_code: "RC_PACKETA_HOME",
      total_price: toCents(s.packetaHomeDeliveryFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
    fallback.push({
      service_name: "Packeta / Z-Box — Ridicare din punct",
      service_code: "RC_PACKETA_POINT",
      total_price: toCents(s.packetaPickupFee),
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
    });
  }

  // Safety net: if no couriers are enabled somehow, return a generic rate
  if (fallback.length === 0) {
    fallback.push({
      service_name: "Livrare standard",
      service_code: "RC_STANDARD",
      total_price: "0",
      currency,
      min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
    });
  }

  return fallback;
}

function deliveryDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
