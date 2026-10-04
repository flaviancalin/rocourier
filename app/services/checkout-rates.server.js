// app/services/checkout-rates.server.js
// Builds the carrier-calculated shipping rates (see routes/carrier-service.js).
import { COURIER_LABELS } from "../utils/couriers.js";
import { locateAddress, findNearestPoints } from "./nearest-points.server.js";

const COURIERS = Object.keys(COURIER_LABELS);
const LOOKUP_BUDGET_MS = 2500; // Shopify falls back to backup rates if we're slow

const TEXT = {
  ro: { home: "Livrare la domiciliu", homeDesc: "Livrare prin curier la adresa ta", point: "Ridicare din punct", km: "km" },
  en: { home: "Home delivery",        homeDesc: "Courier delivery to your address",  point: "Pickup point",        km: "km" },
};

const toCents = (amount) => String(Math.round((parseFloat(amount) || 0) * 100));
const safeCode = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
export const pointServiceCode = (courier, externalId) => `RC_PP_${courier}_${safeCode(externalId)}`;

function deliveryDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export async function buildRates({ rate, settings }) {
  const currency = rate.currency || "RON";
  const t = String(rate.locale || "ro").toLowerCase().startsWith("ro") ? TEXT.ro : TEXT.en;
  const dest = rate.destination || {};
  const enabled = COURIERS.filter((c) => settings[`${c}Enabled`]);

  const attrs = {};
  (rate.cart_attributes || []).forEach((a) => { attrs[a.name] = a.value; });
  const chosen = {
    method:  attrs._rc_method  || attrs._rocourier_method  || "",
    courier: attrs._rc_courier || attrs._rocourier_courier || "",
    pointId: attrs._rc_point_id || attrs._rocourier_point_id || "",
    name:    attrs._rc_point_name || attrs._rocourier_point_name || "",
    address: attrs._rc_point_address || attrs._rocourier_point_address || "",
  };

  const homeRates = enabled.map((c) => ({
    service_name: `${COURIER_LABELS[c].name} — ${t.home}`,
    service_code: `RC_${c.toUpperCase()}_HOME`,
    description:  t.homeDesc,
    total_price:  toCents(settings[`${c}HomeDeliveryFee`]),
    currency,
    min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(3),
  }));

  const pointRate = (p, distance) => ({
    service_name: `${COURIER_LABELS[p.courier].point} — ${p.name}${distance != null ? ` · ${distance.toFixed(1)} ${t.km}` : ""}`,
    service_code: pointServiceCode(p.courier, p.externalId),
    description:  p.address || t.point,
    total_price:  toCents(settings[`${p.courier}PickupFee`]),
    currency,
    min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
  });

  // Locate the address and find the nearest points within the time budget
  let origin = null;
  let nearest = [];
  const lookup = (async () => {
    origin = await locateAddress({
      lat: Number.parseFloat(dest.latitude), lng: Number.parseFloat(dest.longitude),
      postalCode: dest.postal_code, city: dest.city, country: dest.country,
    });
    nearest = await findNearestPoints({
      origin, couriers: enabled, country: dest.country, limit: settings.checkoutLockerCount || 5,
    });
  })().catch((e) => console.error("[carrier-service] nearest lookup failed:", e.message));
  await withTimeout(lookup, LOOKUP_BUDGET_MS);

  // Distances are only shown when Shopify gave us the address's coordinates;
  // a postal-code estimate is good for ranking but not for an exact "0.4 km".
  const exact = origin?.precision === "address";
  const pointRates = [];
  if (chosen.method === "pickup_point" && chosen.pointId && enabled.includes(chosen.courier)) {
    // The shopper already picked a point in the cart widget: offer exactly that one
    const p = { courier: chosen.courier, externalId: chosen.pointId, name: chosen.name || chosen.pointId, address: chosen.address };
    const match = nearest.find((n) => n.courier === p.courier && n.externalId === p.externalId);
    pointRates.push(pointRate(match || p, exact && match ? match.distanceKm : null));
  } else {
    for (const p of nearest) pointRates.push(pointRate(p, exact ? p.distanceKm : null));
  }
  // Shopper chose home delivery in the cart widget: don't offer lockers again
  if (chosen.method === "home_delivery") return homeRates.sort((a, b) => Number(a.total_price) - Number(b.total_price));

  // Address couldn't be located (or lookup too slow): one generic rate per courier so
  // pickup is still offered; the shopper picks the exact point in the cart widget.
  if (!pointRates.length) {
    for (const c of enabled) {
      pointRates.push({
        service_name: `${COURIER_LABELS[c].point} — ${t.point}`,
        service_code: `RC_${c.toUpperCase()}_POINT`,
        description:  t.point,
        total_price:  toCents(settings[`${c}PickupFee`]),
        currency,
        min_delivery_date: deliveryDate(1), max_delivery_date: deliveryDate(2),
      });
    }
  }

  // Cheapest first, so the default checkout option is the cheapest (App Store rule 1.1.10).
  // The sort is stable: among equal prices the widget's point, then the nearest, stay first.
  return [...pointRates, ...homeRates].sort((a, b) => Number(a.total_price) - Number(b.total_price));
}
