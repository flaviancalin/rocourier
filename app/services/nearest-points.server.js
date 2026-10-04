// app/services/nearest-points.server.js
// Finds the pickup points nearest to a shipping address, using only our own
// pickup point table (no paid geocoder). When Shopify doesn't send coordinates,
// the address is located from our points that share its postal code, then its locality.
import { prisma } from "../db.server.js";

const EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// "Bucureşti" / "Bucuresti " / "BUCUREȘTI" → "bucuresti"
export function normalizePlace(s = "") {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function centroid(rows) {
  const pts = rows.filter((r) => r.lat != null && r.lng != null);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, r) => s + r.lat, 0) / pts.length,
    lng: pts.reduce((s, r) => s + r.lng, 0) / pts.length,
  };
}

// Best-effort location of an address: exact coordinates → same postal code →
// postal code prefix (same neighbourhood) → same locality.
export async function locateAddress({ lat, lng, postalCode, city, country }) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, precision: "address" };

  const cc = (country || "ro").toLowerCase();
  const zip = String(postalCode || "").replace(/\s+/g, "");
  const select = { lat: true, lng: true };

  if (zip) {
    const exact = centroid(await prisma.pickupPoint.findMany({ where: { country: cc, zip, isActive: true }, select, take: 50 }));
    if (exact) return { ...exact, precision: "postal_code" };
    for (const len of [zip.length - 1, zip.length - 2]) {
      if (len < 3) break;
      const near = centroid(await prisma.pickupPoint.findMany({
        where: { country: cc, zip: { startsWith: zip.slice(0, len) }, isActive: true }, select, take: 200,
      }));
      if (near) return { ...near, precision: "postal_area" };
    }
  }

  if (city) {
    const name = normalizePlace(city);
    const rows = await prisma.pickupPoint.findMany({
      where: { country: cc, isActive: true, city: { equals: city.trim(), mode: "insensitive" } }, select, take: 500,
    });
    const byCity = centroid(rows.length ? rows : (await prisma.pickupPoint.findMany({
      where: { country: cc, isActive: true, city: { contains: name.split(" ")[0], mode: "insensitive" } }, select, take: 500,
    })));
    if (byCity) return { ...byCity, precision: "city" };
  }
  return null;
}

// Nearest active pickup points for the given couriers, closest first.
export async function findNearestPoints({ origin, couriers, country, limit = 5, maxKm = 30 }) {
  if (!origin || !couriers?.length) return [];
  const cc = (country || "ro").toLowerCase();
  // Bounding box first so the query stays fast on ~140k points
  for (const boxKm of [5, 15, maxKm]) {
    const dLat = boxKm / 111;
    const dLng = boxKm / (111 * Math.cos(toRad(origin.lat)) || 1);
    const rows = await prisma.pickupPoint.findMany({
      where: {
        country: cc, isActive: true, courier: { in: couriers },
        lat: { gte: origin.lat - dLat, lte: origin.lat + dLat },
        lng: { gte: origin.lng - dLng, lte: origin.lng + dLng },
      },
      select: { courier: true, externalId: true, name: true, address: true, city: true, zip: true, lat: true, lng: true, type: true },
      take: 2000,
    });
    if (rows.length >= limit || boxKm === maxKm) {
      return rows
        .map((r) => ({ ...r, distanceKm: distanceKm(origin.lat, origin.lng, r.lat, r.lng) }))
        .filter((r) => r.distanceKm <= maxKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
    }
  }
  return [];
}
