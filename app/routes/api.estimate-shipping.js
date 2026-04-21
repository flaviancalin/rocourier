// app/routes/api.estimate-shipping.js
// Returns an estimated shipping price for the given courier + parameters.
// Best-effort — returns null rather than throwing so the wizard stays usable.
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";
import { samedayAuthenticate, samedayGetClientPickupPoints, samedayGetServices, samedayCalculatePrice } from "../services/sameday.server.js";

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
      const token = await fanAuthenticate({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
      });

      const res = await fetch(`${process.env.FAN_API_BASE || "https://api.fancourier.ro"}/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clientId: settings.fanClientId,
          modality: service || "Standard",
          recipient: { judCode: recipientCounty || "", locCode: recipientCity || "" },
          packages: { weight: parseFloat(weight) || 1, type: 1, number: parseInt(packageCount) || 1 },
          payment: "destinatar",
          cod: parseFloat(codAmount) || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const price = data?.data?.total ?? data?.data?.price ?? data?.data;
        if (price != null && !isNaN(parseFloat(price))) {
          return json({ price: parseFloat(price).toFixed(2), currency: "RON", courier: "FAN Courier" });
        }
      }
    }

    // ── Sameday ──────────────────────────────────────────────────────────────
    if (courier === "sameday" && settings.samedayUsername && settings.samedayPassword) {
      // Need sender pickup point and service ID from Sameday
      const [senderPoints, services] = await Promise.all([
        samedayGetClientPickupPoints({ username: settings.samedayUsername, password: settings.samedayPassword }),
        samedayGetServices({ username: settings.samedayUsername, password: settings.samedayPassword }),
      ]);

      const senderPoint = senderPoints[0];
      const svc = services.find((s) => s.code === service) || services[0];

      if (senderPoint && svc) {
        // Fetch county ID from order if available
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
            destCityId: cityId || undefined,
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
    // Silently fail — price estimate is informational only
  }

  return json({ price: null });
}
