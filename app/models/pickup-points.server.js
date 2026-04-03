// app/models/pickup-points.server.js
import { prisma } from "../db.server.js";
import { fanGetPickupPoints } from "../services/fan-courier.server.js";
import { samedayGetLockers } from "../services/sameday.server.js";

const CACHE_TTL_HOURS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Get pickup points from DB cache (refresh if stale)
// ─────────────────────────────────────────────────────────────────────────────
export async function getPickupPoints({ settings, couriers = ["fan", "sameday"] }) {
  const staleThreshold = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000);

  // Check if cache is fresh
  const cachedCount = await prisma.pickupPoint.count({
    where: {
      courier: { in: couriers },
      isActive: true,
      updatedAt: { gte: staleThreshold },
    },
  });

  if (cachedCount > 0) {
    return prisma.pickupPoint.findMany({
      where: { courier: { in: couriers }, isActive: true },
      orderBy: { county: "asc" },
    });
  }

  // Cache stale → refresh from APIs
  await refreshPickupPointsCache({ settings, couriers });

  return prisma.pickupPoint.findMany({
    where: { courier: { in: couriers }, isActive: true },
    orderBy: { county: "asc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh cache from courier APIs
// ─────────────────────────────────────────────────────────────────────────────
export async function refreshPickupPointsCache({ settings, couriers = ["fan", "sameday"] }) {
  const results = { fan: 0, sameday: 0, errors: [] };

  if (couriers.includes("fan") && settings.fanEnabled && settings.fanClientId) {
    try {
      const fanPoints = await fanGetPickupPoints({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
      });

      // Upsert all FAN points
      for (const p of fanPoints) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "fan", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.fan = fanPoints.length;
    } catch (e) {
      results.errors.push(`FAN: ${e.message}`);
    }
  }

  if (couriers.includes("sameday") && settings.samedayEnabled && settings.samedayUsername) {
    try {
      const samedayPoints = await samedayGetLockers({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        sandbox: !!settings.samedaySandbox,
      });

      for (const p of samedayPoints) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "sameday", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.sameday = samedayPoints.length;
    } catch (e) {
      results.errors.push(`Sameday: ${e.message}`);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format pickup points for the cart widget (minimal payload)
// ─────────────────────────────────────────────────────────────────────────────
export function formatForWidget(points) {
  return points
    .filter((p) => p.lat && p.lng)
    .map((p) => ({
      id: `${p.courier}_${p.externalId}`,
      externalId: p.externalId,
      courier: p.courier,
      type: p.type,
      name: p.name,
      address: p.address,
      city: p.city,
      county: p.county,
      lat: p.lat,
      lng: p.lng,
    }));
}
