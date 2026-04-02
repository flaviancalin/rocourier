// Temporary debug route — returns raw FAN API response for first pickup point
// DELETE after debugging. Access: /api/debug-fan?shop=your-store.myshopify.com
import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";

const FAN_BASE = process.env.FAN_API_BASE || "https://api.fancourier.ro";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return json({ error: "Missing shop" }, { status: 400 });

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings?.fanClientId) return json({ error: "No FAN credentials" }, { status: 400 });

  const token = await fanAuthenticate({
    clientId: settings.fanClientId,
    username: settings.fanUsername,
    password: settings.fanPassword,
  });

  const res = await fetch(`${FAN_BASE}/reports/pickup-points?type=fanbox&perPage=3&currentPage=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  const raw = await res.json();
  return json({ status: res.status, raw });
}
