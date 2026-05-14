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
// Env vars take priority; fall back to the credentials stored in shopSettings
// so merchants don't need to duplicate credentials in Railway variables.
async function getSyncCredentials() {
  const shop = await prisma.shopSettings.findFirst();
  return {
    fan: {
      clientId: process.env.FAN_SYNC_CLIENT_ID  || shop?.fanClientId  || null,
      username: process.env.FAN_SYNC_USERNAME   || shop?.fanUsername  || null,
      password: process.env.FAN_SYNC_PASSWORD   || shop?.fanPassword  || null,
    },
    sameday: {
      username: process.env.SAMEDAY_SYNC_USERNAME || shop?.samedayUsername || null,
      password: process.env.SAMEDAY_SYNC_PASSWORD || shop?.samedayPassword || null,
      sandbox:  shop?.samedaySandbox || false,
    },
    cargus: {
      subscriptionKey: process.env.CARGUS_SYNC_SUBSCRIPTION_KEY || shop?.cargusSubscriptionKey || null,
      username:        process.env.CARGUS_SYNC_USERNAME          || shop?.cargusUsername         || null,
      password:        process.env.CARGUS_SYNC_PASSWORD          || shop?.cargusPassword         || null,
    },
    packeta: {
      apiKey: process.env.PACKETA_SYNC_API_KEY || shop?.packetaApiKey || null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get pickup points from DB cache (auto-refresh if stale)
// couriers: which carriers to return — caller filters by merchant's enabled list
// ─────────────────────────────────────────────────────────────────────────────
export async function getPickupPoints({
  couriers = ["fan", "sameday", "cargus", "gls", "packeta"],
  country = null,
  lat = null,
  lng = null,
} = {}) {
  const staleThreshold = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000);
  const countryFilter = country ? { country } : {};

  // When the customer's coordinates are known, restrict to a ~200km bounding box
  // so we don't return thousands of points for large countries (DE, FR, PL…).
  // ±2° lat ≈ 220 km; ±3° lng ≈ 210 km at 46° N (mid-Europe).
  const geoFilter = (lat != null && lng != null) ? {
    lat: { gte: lat - 2, lte: lat + 2 },
    lng: { gte: lng - 3, lte: lng + 3 },
  } : {};

  const cachedCount = await prisma.pickupPoint.count({
    where: {
      courier: { in: couriers },
      isActive: true,
      updatedAt: { gte: staleThreshold },
      ...countryFilter,
    },
  });

  if (cachedCount > 0) {
    return prisma.pickupPoint.findMany({
      where: { courier: { in: couriers }, isActive: true, ...countryFilter, ...geoFilter },
      orderBy: { county: "asc" },
    });
  }

  // Cache empty/stale — check if we have ANY points at all (ignoring TTL).
  // If yes, return them now (stale-while-revalidate) and kick off a background refresh.
  // If the table is truly empty, kick off a background sync and return [] immediately
  // so the widget stays responsive instead of hanging for 30-60s.
  const anyCount = await prisma.pickupPoint.count({
    where: { courier: { in: couriers }, isActive: true, ...countryFilter },
  });

  refreshPickupPointsCache({ couriers }).catch((e) =>
    console.error("BG pickup sync error:", e)
  );

  if (anyCount > 0) {
    return prisma.pickupPoint.findMany({
      where: { courier: { in: couriers }, isActive: true, ...countryFilter, ...geoFilter },
      orderBy: { county: "asc" },
    });
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh cache from courier APIs using app-level env var credentials
// No merchant settings needed — pickup points are global data
// ─────────────────────────────────────────────────────────────────────────────
// Bulk replace helper — delete all for a courier then insert all at once.
// This is orders of magnitude faster than N individual upserts.
async function bulkReplace(courier, rows) {
  if (rows.length === 0) return;
  await prisma.pickupPoint.deleteMany({ where: { courier } });
  await prisma.pickupPoint.createMany({ data: rows, skipDuplicates: true });
}

export async function refreshPickupPointsCache({ couriers = ["fan", "sameday", "cargus", "gls", "packeta"] } = {}) {
  const creds = await getSyncCredentials();
  const results = { fan: 0, sameday: 0, cargus: 0, gls: 0, packeta: 0, errors: [] };
  const samedayCreds = creds.sameday;

  // All carriers in parallel — total time = slowest single carrier, not sum of all
  await Promise.allSettled([

    // ── FAN ────────────────────────────────────────────────────────────────────
    (async () => {
      if (!couriers.includes("fan")) return;
      if (!creds.fan.clientId || !creds.fan.username || !creds.fan.password) {
        results.errors.push("FAN: credențiale lipsă (setează FAN_SYNC_CLIENT_ID, FAN_SYNC_USERNAME, FAN_SYNC_PASSWORD)");
        return;
      }
      try {
        const points = await fanGetPickupPoints({
          clientId: creds.fan.clientId,
          username: creds.fan.username,
          password: creds.fan.password,
        });
        await bulkReplace("fan", points.map((p) => ({ ...p, country: "ro", isActive: true })));
        results.fan = points.length;
        console.error(`[SYNC] FAN: ${points.length} puncte stocate`);
      } catch (e) {
        results.errors.push(`FAN: ${e.message}`);
        console.error("[SYNC] FAN error:", e.message);
      }
    })(),

    // ── Sameday ────────────────────────────────────────────────────────────────
    (async () => {
      if (!couriers.includes("sameday")) return;
      if (!samedayCreds.username || !samedayCreds.password) {
        results.errors.push("Sameday: credențiale lipsă (setează SAMEDAY_SYNC_USERNAME, SAMEDAY_SYNC_PASSWORD)");
        return;
      }
      try {
        const points = await samedayGetLockers({
          username: samedayCreds.username,
          password: samedayCreds.password,
          sandbox:  !!samedayCreds.sandbox,
        });
        await bulkReplace("sameday", points.map((p) => ({ ...p, country: "ro", isActive: true })));
        results.sameday = points.length;
        console.error(`[SYNC] Sameday: ${points.length} puncte stocate`);
      } catch (e) {
        if (e.message?.includes("[404]")) { results.sameday = 0; return; }
        results.errors.push(`Sameday: ${e.message}`);
        console.error("[SYNC] Sameday error:", e.message);
      }
    })(),

    // ── Cargus ─────────────────────────────────────────────────────────────────
    (async () => {
      if (!couriers.includes("cargus")) return;
      if (!creds.cargus.subscriptionKey || !creds.cargus.username) {
        results.errors.push("Cargus: credențiale lipsă (setează CARGUS_SYNC_SUBSCRIPTION_KEY, CARGUS_SYNC_USERNAME, CARGUS_SYNC_PASSWORD)");
        return;
      }
      try {
        const points = await cargusGetPickupPoints({
          subscriptionKey: creds.cargus.subscriptionKey,
          username:        creds.cargus.username,
          password:        creds.cargus.password,
        });
        await bulkReplace("cargus", points.map((p) => ({ ...p, country: "ro", isActive: true })));
        results.cargus = points.length;
        console.error(`[SYNC] Cargus: ${points.length} puncte stocate`);
      } catch (e) {
        results.errors.push(`Cargus: ${e.message}`);
        console.error("[SYNC] Cargus error:", e.message);
      }
    })(),

    // ── GLS ────────────────────────────────────────────────────────────────────
    (async () => {
      if (!couriers.includes("gls")) return;
      try {
        const points = await glsGetPickupPoints();
        await bulkReplace("gls", points.map((p) => ({ ...p, isActive: true })));
        results.gls = points.length;
        console.error(`[SYNC] GLS: ${points.length} puncte stocate`);
      } catch (e) {
        results.errors.push(`GLS: ${e.message}`);
        console.error("[SYNC] GLS error:", e.message);
      }
    })(),

    // ── Packeta ────────────────────────────────────────────────────────────────
    (async () => {
      if (!couriers.includes("packeta")) return;
      if (!creds.packeta.apiKey) {
        results.errors.push("Packeta: credențiale lipsă (setează PACKETA_SYNC_API_KEY)");
        return;
      }
      try {
        const points = await packetaGetPickupPoints({ apiKey: creds.packeta.apiKey });
        await bulkReplace("packeta", points.map((p) => ({ ...p, isActive: true })));
        results.packeta = points.length;
        console.error(`[SYNC] Packeta: ${points.length} puncte stocate`);
      } catch (e) {
        results.errors.push(`Packeta: ${e.message}`);
        console.error("[SYNC] Packeta error:", e.message);
      }
    })(),

  ]);

  console.error("[SYNC] Finalizat:", JSON.stringify({ ...results, errors: results.errors }));
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
