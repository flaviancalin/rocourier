// app/routes/api.estimate-shipping.js
// Best-effort shipping price estimate — returns null rather than throwing.
// Service imports are dynamic to avoid Remix/Vite "server-only referenced by client" error.
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const body = await request.json();
  const { courier, service, weight, packageCount, codAmount,
          recipientCity, recipientCounty, orderId } = body;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return json({ price: null });

  try {
    // ── FAN Courier ──────────────────────────────────────────────────────────
    if (courier === "fan" && settings.fanClientId && settings.fanUsername && settings.fanPassword) {
      const { fanCalculatePrice } = await import("../services/fan-courier.server.js");
      const data = await fanCalculatePrice({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        params: {
          service: service || "Standard",
          recipientCounty: recipientCounty || "",
          recipientCity: recipientCity || "",
          weight: parseFloat(weight) || 1,
          packageCount: parseInt(packageCount) || 1,
          codAmount: parseFloat(codAmount) || 0,
        },
      });
      const price = data?.total ?? data?.price ?? data;
      if (price != null && !isNaN(parseFloat(price))) {
        return json({ price: parseFloat(price).toFixed(2), currency: "RON", courier: "FAN Courier" });
      }
    }

    // ── Sameday ──────────────────────────────────────────────────────────────
    if (courier === "sameday" && settings.samedayUsername && settings.samedayPassword) {
      const { samedayGetClientPickupPoints, samedayGetServices, samedayCalculatePrice } =
        await import("../services/sameday.server.js");

      const [senderPoints, services] = await Promise.all([
        samedayGetClientPickupPoints({ username: settings.samedayUsername, password: settings.samedayPassword }),
        samedayGetServices({ username: settings.samedayUsername, password: settings.samedayPassword }),
      ]);

      const senderPoint = senderPoints[0];
      const svc = services.find((s) => s.code === service) || services[0];

      if (senderPoint && svc) {
        const order = orderId ? await prisma.order.findFirst({ where: { shop, id: orderId } }) : null;
        const countyId = order?.samedayCountyId;
        const cityId   = order?.samedayCityId;

        if (countyId) {
          const data = await samedayCalculatePrice({
            username: settings.samedayUsername,
            password: settings.samedayPassword,
            pickupPointId: senderPoint.id,
            serviceId: svc.id,
            destCountyId: countyId,
            ...(cityId ? { destCityId: cityId } : {}),
            weight: parseFloat(weight) || 1,
            codAmount: parseFloat(codAmount) || 0,
          });
          const price = data?.totalAmount ?? data?.amount ?? data?.price;
          if (price != null && !isNaN(parseFloat(price))) {
            return json({ price: parseFloat(price).toFixed(2), currency: "RON", courier: "Sameday" });
          }
        }
      }
    }

  } catch (_) {
    // Non-fatal — price estimate is informational only
  }

  return json({ price: null });
}
