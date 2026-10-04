// app/routes/proxy.jsx
// Shopify App Proxy — serves requests routed through Shopify's CDN.
// When the app proxy is configured in shopify.app.toml, requests to:
//   https://SHOP.myshopify.com/apps/rocourier/*
// are forwarded here as:
//   https://YOUR-APP-URL.railway.app/proxy/*?shop=SHOP&signature=...
// (sub-paths are handled by proxy.$.jsx, which re-exports this loader)
//
// This gives us a same-origin URL for the cart widget — useful if
// the merchant's theme has strict CORS policies.

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { getPickupPoints, formatForWidget } from "../models/pickup-points.server.js";

export async function loader({ request }) {
  // App proxy requests are authenticated differently — using HMAC signature
  const { liquid } = await authenticate.public.appProxy(request);

  const url  = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // Route: /apps/rocourier/widget-config
  if (url.pathname.includes("widget-config") || url.searchParams.get("resource") === "widget-config") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    // Fees come from the same settings the carrier service charges at checkout,
    // so the cart widget never shows a price different from the checkout rate.
    const fees = settings ? Object.fromEntries(["fan", "sameday", "cargus", "gls", "packeta"].map((c) => [c, {
      home:   settings[`${c}HomeDeliveryFee`] ?? 0,
      pickup: settings[`${c}PickupFee`]       ?? 0,
    }])) : null;
    return json({ widgetLanguage: settings?.widgetLanguage || "auto", fees });
  }

  // Route: /apps/rocourier/pickup-points
  if (url.pathname.includes("pickup-points") || url.searchParams.get("resource") === "pickup-points") {
    const courierParam = url.searchParams.get("courier") || "all";
    const county  = url.searchParams.get("county")  || null;
    const country = url.searchParams.get("country") || null;
    const lat     = url.searchParams.get("lat") ? parseFloat(url.searchParams.get("lat")) : null;
    const lng     = url.searchParams.get("lng") ? parseFloat(url.searchParams.get("lng")) : null;

    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings) return json({ points: [] });

    const ENABLED_MAP = {
      fan:     settings.fanEnabled,
      sameday: settings.samedayEnabled,
      cargus:  settings.cargusEnabled,
      gls:     settings.glsEnabled,
      packeta: settings.packetaEnabled,
    };
    // Widget sends a comma-separated list; only couriers enabled in the app are served
    const requested = courierParam === "all"
      ? Object.keys(ENABLED_MAP)
      : courierParam.split(",").map((c) => c.trim()).filter(Boolean);
    const couriers = requested.filter((c) => ENABLED_MAP[c]);
    if (!couriers.length) return json({ points: [] });

    const points = await getPickupPoints({ couriers, country, lat, lng });
    const filtered = county
      ? points.filter((p) => p.county?.toLowerCase().includes(county.toLowerCase()))
      : points;

    return json({ points: formatForWidget(filtered) });
  }

  // Default: return shop info
  return json({ status: "Picklo proxy active", shop });
}
