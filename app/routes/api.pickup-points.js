// app/routes/api.pickup-points.js
// PUBLIC endpoint — called from the cart widget on the storefront
// No Shopify session required — uses shop domain to look up settings
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import { getPickupPoints, formatForWidget } from "../models/pickup-points.server.js";

// ─────────────────────────────────────────────────────────────────────────────
// CORS helper — storefront JS needs cross-origin access
// ─────────────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600", // cache 1h
  };
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "*";

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const shop = url.searchParams.get("shop");
  const courierParam = url.searchParams.get("courier") || "all"; // "fan" | "sameday" | "all"
  const county = url.searchParams.get("county") || null;

  if (!shop) {
    return json({ error: "Missing shop parameter" }, { status: 400 });
  }

  // Look up shop settings
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return json({ points: [], error: "Shop not configured" }, {
      headers: corsHeaders(origin),
    });
  }

  const allCouriers = ["fan", "sameday", "cargus", "gls", "packeta"];
  // courierParam can be "all", a single value "fan", or comma-separated "fan,sameday,cargus"
  const couriers = courierParam === "all"
    ? allCouriers
    : courierParam.split(",").map((c) => c.trim()).filter(Boolean);

  // Filter by enabled couriers
  const enabledCouriers = couriers.filter((c) => {
    if (c === "fan")     return settings.fanEnabled;
    if (c === "sameday") return settings.samedayEnabled;
    if (c === "cargus")  return settings.cargusEnabled;
    if (c === "gls")     return settings.glsEnabled;
    if (c === "packeta") return settings.packetaEnabled;
    return false;
  });

  try {
    const points = await getPickupPoints({ settings, couriers: enabledCouriers });
    const filtered = county
      ? points.filter((p) => p.county?.toLowerCase().includes(county.toLowerCase()))
      : points;

    return json(
      { points: formatForWidget(filtered) },
      { headers: corsHeaders(origin) }
    );
  } catch (e) {
    console.error("Pickup points API error:", e);
    return json({ points: [], error: e.message }, {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}
