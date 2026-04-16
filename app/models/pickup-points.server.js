// app/models/pickup-points.server.js
// Pickup points are carrier-level public infrastructure — the same locations
// exist regardless of which merchant is using the app.
// Sync credentials come from app-level env vars, NOT from merchant settings.
// Merchant settings only control which couriers to SHOW in their widget.
import { prisma } from "../db.server.js";
import { fanGetPickupPoints } from "../services/fan-courier.server.js";
import { samedayGetLockers } from "../services/sameday.server.js";
import { cargusGetPickupPoints } from "../services/cargus.server.js";
import { glsGetPickupPoints    } from "../services/gls.server.js";
import { packetaGetPickupPoints } from "../services/packeta.server.js";

const CACHE_TTL_HOURS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// App-level sync credentials from environment variables
// Set these in Railway: FAN_SYNC_CLIENT_ID, FAN_SYNC_USERNAME, FAN_SYNC_PASSWORD,
// SAMEDAY_SYNC_USERNAME, SAMEDAY_SYNC_PASSWORD,
// CARGUS_SYNC_SUBSCRIPTION_KEY, CARGUS_SYNC_USERNAME, CARGUS_SYNC_PASSWORD,
// PACKETA_SYNC_API_KEY
// GLS needs no credentials — uses public JSON API
// ─────────────────────────────────────────────────────────────────────────────
function getSyncCredentials() {
  return {
    fan: {
      clientId: process.env.FAN_SYNC_CLIENT_ID,
      username: process.env.FAN_SYNC_USERNAME,
      password: process.env.FAN_SYNC_PASSWORD,
    },
    sameday: {
      username: process.env.SAMEDAY_SYNC_USERNAME,
      password: process.env.SAMEDAY_SYNC_PASSWORD,
    },
    cargus: {
      subscriptionKey: process.env.CARGUS_SYNC_SUBSCRIPTION_KEY,
      username:        process.env.CARGUS_SYNC_USERNAME,
      password:        process.env.CARGUS_SYNC_PASSWORD,
    },
    packeta: {
      apiKey: process.env.PACKETA_SYNC_API_KEY,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get pickup points from DB cache (auto-refresh if stale)
// couriers: which carriers to return — caller filters by merchant's enabled list
// ─────────────────────────────────────────────────────────────────────────────
export async function getPickupPoints({ couriers = ["fan", "sameday", "cargus", "gls", "packeta"] } = {}) {
  const staleThreshold = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000);

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

  // Cache stale — refresh from carrier APIs using app-level credentials
  await refreshPickupPointsCache({ couriers });

  return prisma.pickupPoint.findMany({
    where: { courier: { in: couriers }, isActive: true },
    orderBy: { county: "asc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh cache from courier APIs using app-level env var credentials
// No merchant settings needed — pickup points are global data
// ─────────────────────────────────────────────────────────────────────────────
export async function refreshPickupPointsCache({ couriers = ["fan", "sameday", "cargus", "gls", "packeta"] } = {}) {
  const creds = getSyncCredentials();
  const results = { fan: 0, sameday: 0, cargus: 0, gls: 0, packeta: 0, errors: [] };

  if (couriers.includes("fan") && creds.fan.clientId && creds.fan.username && creds.fan.password) {
    try {
      const points = await fanGetPickupPoints({
        clientId: creds.fan.clientId,
        username: creds.fan.username,
        password: creds.fan.password,
      });
      for (const p of points) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "fan", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.fan = points.length;
    } catch (e) {
      results.errors.push(`FAN: ${e.message}`);
    }
  } else if (couriers.includes("fan") && !creds.fan.clientId) {
    results.errors.push("FAN: sync credentials not configured (set FAN_SYNC_CLIENT_ID, FAN_SYNC_USERNAME, FAN_SYNC_PASSWORD)");
  }

  if (couriers.includes("sameday") && creds.sameday.username && creds.sameday.password) {
    try {
      const points = await samedayGetLockers({
        username: creds.sameday.username,
        password: creds.sameday.password,
      });
      for (const p of points) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "sameday", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.sameday = points.length;
    } catch (e) {
      if (e.message?.includes("[404]")) {
        results.sameday = 0;
      } else {
        results.errors.push(`Sameday: ${e.message}`);
      }
    }
  } else if (couriers.includes("sameday") && !creds.sameday.username) {
    results.errors.push("Sameday: sync credentials not configured (set SAMEDAY_SYNC_USERNAME, SAMEDAY_SYNC_PASSWORD)");
  }

  if (couriers.includes("cargus") && creds.cargus.subscriptionKey && creds.cargus.username) {
    try {
      const points = await cargusGetPickupPoints({
        subscriptionKey: creds.cargus.subscriptionKey,
        username:        creds.cargus.username,
        password:        creds.cargus.password,
      });
      for (const p of points) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "cargus", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.cargus = points.length;
    } catch (e) {
      results.errors.push(`Cargus: ${e.message}`);
    }
  } else if (couriers.includes("cargus") && !creds.cargus.subscriptionKey) {
    results.errors.push("Cargus: sync credentials not configured (set CARGUS_SYNC_SUBSCRIPTION_KEY, CARGUS_SYNC_USERNAME, CARGUS_SYNC_PASSWORD)");
  }

  if (couriers.includes("gls")) {
    try {
      const points = await glsGetPickupPoints();
      for (const p of points) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "gls", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.gls = points.length;
    } catch (e) {
      results.errors.push(`GLS: ${e.message}`);
    }
  }

  if (couriers.includes("packeta") && creds.packeta.apiKey) {
    try {
      const points = await packetaGetPickupPoints({ apiKey: creds.packeta.apiKey });
      for (const p of points) {
        await prisma.pickupPoint.upsert({
          where: { courier_externalId: { courier: "packeta", externalId: p.externalId } },
          update: { ...p, isActive: true, updatedAt: new Date() },
          create: p,
        });
      }
      results.packeta = points.length;
    } catch (e) {
      results.errors.push(`Packeta: ${e.message}`);
    }
  } else if (couriers.includes("packeta") && !creds.packeta.apiKey) {
    results.errors.push("Packeta: sync credentials not configured (set PACKETA_SYNC_API_KEY)");
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
