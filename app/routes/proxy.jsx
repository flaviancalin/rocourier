// app/routes/proxy.jsx
// Shopify App Proxy — serves requests routed through Shopify's CDN.
// When the app proxy is configured in shopify.app.toml, requests to:
//   https://SHOP.myshopify.com/apps/rocourier/*
// are forwarded here as:
//   https://YOUR-APP-URL.railway.app/proxy?shop=SHOP&...
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

  const url = new URL(request.url);
  const path     = url.searchParams.get("path_prefix") || "";
  const shop     = url.searchParams.get("shop");
  const logged_in_customer_id = url.searchParams.get("logged_in_customer_id");

  // Route: /apps/rocourier/pickup-points
  if (url.pathname.includes("pickup-points") || url.searchParams.get("resource") === "pickup-points") {
    const courier = url.searchParams.get("courier") || "all";
    const county  = url.searchParams.get("county")  || null;

    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings) return json({ points: [] });

    const couriers = courier === "all"
      ? ["fan", "sameday"].filter((c) => {
          if (c === "fan")     return settings.fanEnabled;
          if (c === "sameday") return settings.samedayEnabled;
          return false;
        })
      : [courier];

    const points = await getPickupPoints({ settings, couriers });
    const filtered = county
      ? points.filter((p) => p.county?.toLowerCase().includes(county.toLowerCase()))
      : points;

    return json(
      { points: formatForWidget(filtered) },
      {
        headers: {
          "Content-Type": "application/json",
          // Liquid header tells Shopify to serve this as Liquid template
          // (we're returning JSON, so it's treated as-is)
        },
      }
    );
  }

  // Default: return shop info
  return json({ status: "RoCourier proxy active", shop });
}
