// app/routes/api.widget-config.js
// PUBLIC endpoint — called from the cart widget on the storefront
// Returns widget-level configuration (language override, etc.)
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
  };
}

export async function loader({ request }) {
  const url    = new URL(request.url);
  const origin = request.headers.get("Origin") || "*";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const shop = url.searchParams.get("shop");
  if (!shop) {
    return json({ error: "Missing shop" }, { status: 400, headers: corsHeaders(origin) });
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const widgetLanguage = settings?.widgetLanguage || "auto";

  return json({ widgetLanguage }, { headers: corsHeaders(origin) });
}
