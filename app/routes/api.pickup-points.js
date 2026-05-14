// app/routes/api.pickup-points.js
// PUBLIC endpoint — called from the cart widget on the storefront
// No Shopify session required — pickup points are carrier-level public data
import { json } from "@remix-run/node";
import { getPickupPoints, formatForWidget } from "../models/pickup-points.server.js";

// ─────────────────────────────────────────────────────────────────────────────
// CORS helper — storefront JS needs cross-origin access
// ─────────────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600",
  };
}

export async function loader({ request }) {
  const url    = new URL(request.url);
  const origin = request.headers.get("Origin") || "*";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const shop        = url.searchParams.get("shop");
  const courierParam = url.searchParams.get("courier") || "all";
  const county      = url.searchParams.get("county")  || null;
  const country     = url.searchParams.get("country") || null;
  const lat         = url.searchParams.get("lat") ? parseFloat(url.searchParams.get("lat")) : null;
  const lng         = url.searchParams.get("lng") ? parseFloat(url.searchParams.get("lng")) : null;

  if (!shop) {
    return json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders(origin) });
  }

  const allCouriers = ["fan", "sameday", "cargus", "gls", "packeta"];
  // Widget sends comma-separated list of couriers it has enabled in block settings
  const couriers = courierParam === "all"
    ? allCouriers
    : courierParam.split(",").map((c) => c.trim()).filter(Boolean);

  try {
    const points   = await getPickupPoints({ couriers, country, lat, lng });
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
