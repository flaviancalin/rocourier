// app/services/rates-compare.server.js
// What would this parcel cost with each courier the merchant has connected?
// Uses the couriers' own price APIs (contract prices). Couriers without a price API
// are listed with price null so the merchant still sees every option.
import { fanCalculatePrice } from "./fan-courier.server.js";
import { samedayGetClientPickupPoints, samedayGetServices, samedayGetCounties, samedayGetCities, samedayCalculatePrice, samedayServiceFor } from "./sameday.server.js";
import { dpdCalculatePrice } from "./dpd.server.js";
import { cargusCalculatePrice } from "./cargus.server.js";
import { normalizeName, normalizeRoCounty } from "../utils/address.js";
import { COURIER_LABELS } from "../utils/couriers.js";

const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

async function fanPrice(s, p) {
  const data = await fanCalculatePrice({ clientId: s.fanClientId, username: s.fanUsername, password: s.fanPassword,
    params: { service: p.pickup ? (p.cod > 0 ? "FANbox Cont Colector" : "FANbox") : "Standard", recipientCounty: normalizeRoCounty(p.county), recipientCity: p.city, weight: p.weight, packageCount: p.parcels, codAmount: p.cod } });
  return num(data?.total ?? data?.price ?? data);
}

async function samedayPrice(s, p) {
  const auth = { username: s.samedayUsername, password: s.samedayPassword, sandbox: !!s.samedaySandbox };
  const [points, services, counties] = await Promise.all([samedayGetClientPickupPoints(auth), samedayGetServices(auth), samedayGetCounties(auth)]);
  const county = counties.find((c) => normalizeName(c.name) === normalizeName(normalizeRoCounty(p.county)));
  if (!points[0] || !county) return null;
  const cities = await samedayGetCities({ ...auth, countyId: county.id });
  const city = cities.find((c) => normalizeName(c.name) === normalizeName(p.city));
  const svc = samedayServiceFor(services, { pointType: p.pickup ? (p.pointType === "pudo" ? "pudo" : "easybox") : null });
  if (!svc) return null;
  const data = await samedayCalculatePrice({ ...auth, pickupPointId: points[0].id, serviceId: svc.id, destCountyId: county.id, ...(city ? { destCityId: city.id } : {}), weight: p.weight, codAmount: p.cod });
  return num(data?.amount ?? data?.totalAmount ?? data?.price);
}

async function dpdPrice(s, p) {
  const r = await dpdCalculatePrice({ username: s.dpdUsername, password: s.dpdPassword, serviceId: s.dpdServiceId || undefined,
    city: p.city, county: p.county, postCode: p.zip, pickupOfficeId: p.pickup && p.courierOfPoint === "dpd" ? p.pointId : null,
    weight: p.weight, codAmount: p.cod, parcels: p.parcels });
  return num(r.total);
}

async function cargusPrice(s, p) {
  if (p.pickup) return null; // Ship & Go pricing needs the parcel codes of a real AWB
  const r = await cargusCalculatePrice({ subscriptionKey: s.cargusSubscriptionKey, username: s.cargusUsername, password: s.cargusPassword,
    from: { county: normalizeRoCounty(s.senderCounty), city: s.senderCity }, to: { county: normalizeRoCounty(p.county), city: p.city },
    weight: p.weight, parcels: p.parcels, codAmount: p.cod, serviceId: p.weight > 31 ? 35 : 34 });
  return num(r.GrandTotal);
}

const PRICERS = {
  fan: [(s) => s.fanClientId && s.fanUsername, fanPrice],
  sameday: [(s) => s.samedayUsername, samedayPrice],
  dpd: [(s) => s.dpdUsername && s.dpdServiceId, dpdPrice],
  cargus: [(s) => s.cargusSubscriptionKey && s.cargusUsername && s.senderCity, cargusPrice],
};

// → [{ courier, name, price|null, error? }] cheapest first, unknown prices last
export async function compareRates(settings, order) {
  const p = {
    city: order.shippingCity, county: order.shippingCounty, zip: order.shippingZip,
    weight: Number(order.weight) || settings.defaultWeight || 1, parcels: order.packageCount || 1,
    cod: Number(order.codAmount) || 0, pickup: order.shippingMethod === "pickup_point",
    pointId: order.pickupPointId, courierOfPoint: order.courierType,
  };
  const enabled = Object.keys(COURIER_LABELS).filter((c) => settings[`${c}Enabled`]);
  const rows = await Promise.all(enabled.map(async (c) => {
    const row = { courier: c, name: COURIER_LABELS[c].name, price: null };
    const pricer = PRICERS[c];
    if (!pricer || !pricer[0](settings)) return { ...row, note: "fără API de tarife" };
    try {
      return { ...row, price: await Promise.race([pricer[1](settings, p), new Promise((r) => setTimeout(() => r(null), 8000))]) };
    } catch (e) {
      return { ...row, error: e.message.slice(0, 160) };
    }
  }));
  return rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}
