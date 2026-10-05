// app/services/checkout-setup.server.js
// Puts Picklo's delivery options into the store's checkout, on any Shopify plan:
//   • "ccs"    — store has carrier-calculated shipping: register Picklo's carrier
//                service and attach it to the shipping zones it serves (nearest
//                lockers + home delivery, priced with the merchant's fixed fees).
//   • "manual" — no CCS (e.g. Basic plan): create/update fixed-price rates in those
//                zones from Picklo's fees; the cart widget picks the exact locker.
import { prisma } from "../db.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
export const CARRIER_CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
const CARRIER_NAME = "Picklo";

// Countries each courier delivers in (zones covering none of these are left alone)
const COURIER_COUNTRIES = {
  fan:     ["RO"],
  sameday: ["RO", "HU", "BG"],
  cargus:  ["RO"],
  gls:     ["RO", "HU", "CZ", "SK", "SI", "HR", "DE", "AT", "PL"],
  packeta: ["CZ", "SK", "HU", "RO", "PL", "DE", "AT", "SI", "HR", "BG"],
};
const COURIERS = Object.keys(COURIER_LABELS);

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

// Rate names merchants and shoppers see; also how Picklo recognises its own rates
export function manualRateNames(courier) {
  const l = COURIER_LABELS[courier];
  return { home: `${l.name} — Livrare la domiciliu`, point: `${l.point} — Ridicare din punct` };
}

// ── Carrier service ──────────────────────────────────────────────────────────
// Returns { mode: "ccs", carrierServiceId } or { mode: "manual", reason }.
export async function ensureCarrierService(admin) {
  const list = await gql(admin, `{ carrierServices(first: 50) { nodes { id callbackUrl active } } }`);
  const ours = list.carrierServices.nodes.find((c) => c.callbackUrl === CARRIER_CALLBACK_URL);
  if (ours) return { mode: "ccs", carrierServiceId: ours.id };

  const data = await gql(admin, `
    mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
      carrierServiceCreate(input: $input) { carrierService { id } userErrors { field message } }
    }`, { input: { name: CARRIER_NAME, callbackUrl: CARRIER_CALLBACK_URL, supportsServiceDiscovery: true, active: true } });
  const result = data.carrierServiceCreate;
  if (result.carrierService?.id) return { mode: "ccs", carrierServiceId: result.carrierService.id };
  // Shopify refuses when the plan has no carrier-calculated shipping
  return { mode: "manual", reason: result.userErrors.map((e) => e.message).join("; ") };
}

// ── Shipping zones ───────────────────────────────────────────────────────────
async function readZones(admin) {
  const data = await gql(admin, `{
    shop { currencyCode }
    deliveryProfiles(first: 10) { nodes { id name
      profileLocationGroups { locationGroup { id }
        locationGroupZones(first: 50) { nodes {
          zone { id name countries { code { countryCode } } }
          methodDefinitions(first: 50) { nodes { id name active
            rateProvider { __typename
              ... on DeliveryParticipant { carrierService { id } }
              ... on DeliveryRateDefinition { id price { amount } }
            } } }
        } }
      } } }
  }`);
  const zones = [];
  for (const profile of data.deliveryProfiles.nodes) {
    for (const group of profile.profileLocationGroups) {
      for (const z of group.locationGroupZones.nodes) {
        zones.push({
          profileId: profile.id, profileName: profile.name, locationGroupId: group.locationGroup.id,
          zoneId: z.zone.id, zoneName: z.zone.name,
          countries: z.zone.countries.map((c) => c.code.countryCode).filter(Boolean),
          methods: z.methodDefinitions.nodes,
        });
      }
    }
  }
  return { currency: data.shop.currencyCode, zones };
}

// A zone's rates apply to every country in it, so a courier is only offered in a
// zone when it serves all of that zone's countries (no "FANbox" for a shopper in Dubai).
const couriersForZone = (zone, enabled) =>
  zone.countries.length ? enabled.filter((c) => zone.countries.every((cc) => COURIER_COUNTRIES[c].includes(cc))) : [];

async function updateZone(admin, zone, { create = [], update = [], remove = [] }) {
  if (!create.length && !update.length && !remove.length) return;
  const data = await gql(admin, `
    mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) { profile { id } userErrors { field message } }
    }`, {
    id: zone.profileId,
    profile: {
      ...(remove.length ? { methodDefinitionsToDelete: remove } : {}),
      locationGroupsToUpdate: [{ id: zone.locationGroupId, zonesToUpdate: [{
      id: zone.zoneId,
      ...(create.length ? { methodDefinitionsToCreate: create } : {}),
      ...(update.length ? { methodDefinitionsToUpdate: update } : {}),
    }] }] },
  });
  const errors = data.deliveryProfileUpdate.userErrors;
  if (errors.length) throw new Error(`${zone.zoneName}: ${errors.map((e) => e.message).join("; ")}`);
}

// CCS: attach Picklo's carrier service to every zone one of the enabled couriers serves
async function attachCarrier(admin, carrierServiceId, enabled) {
  const { zones } = await readZones(admin);
  const done = [];
  for (const zone of zones) {
    if (!couriersForZone(zone, enabled).length) continue;
    const already = zone.methods.find((m) => m.rateProvider?.carrierService?.id === carrierServiceId);
    if (already?.active) { done.push(zone.zoneName); continue; }
    await updateZone(admin, zone, already
      ? { update: [{ id: already.id, active: true }] }
      : { create: [{ name: CARRIER_NAME, active: true, participant: { carrierServiceId, adaptToNewServices: true } }] });
    done.push(zone.zoneName);
  }
  return done;
}

// Manual: create or re-price Picklo's fixed rates in every zone the couriers serve
async function syncManualRates(admin, settings, enabled) {
  const { currency, zones } = await readZones(admin);
  const done = [];
  for (const zone of zones) {
    const couriers = couriersForZone(zone, enabled);
    // Picklo rates for couriers that don't (or no longer) belong in this zone
    const ownNames = new Set(COURIERS.flatMap((c) => Object.values(manualRateNames(c))));
    const keepNames = new Set(couriers.flatMap((c) => Object.values(manualRateNames(c))));
    const remove = zone.methods
      .filter((m) => ownNames.has(m.name) && !keepNames.has(m.name) && m.rateProvider?.__typename === "DeliveryRateDefinition")
      .map((m) => m.id);
    if (!couriers.length) {
      await updateZone(admin, zone, { remove });
      continue;
    }
    const create = [];
    const update = [];
    for (const c of couriers) {
      const names = manualRateNames(c);
      for (const [kind, name] of Object.entries(names)) {
        const fee = Number(settings[kind === "home" ? `${c}HomeDeliveryFee` : `${c}PickupFee`]) || 0;
        const price = { amount: fee.toFixed(2), currencyCode: currency };
        const existing = zone.methods.find((m) => m.name === name && m.rateProvider?.__typename === "DeliveryRateDefinition");
        if (!existing) create.push({ name, active: true, rateDefinition: { price } });
        else if (Number(existing.rateProvider.price.amount) !== fee || !existing.active) {
          update.push({ id: existing.id, active: true, rateDefinition: { id: existing.rateProvider.id, price } });
        }
      }
    }
    await updateZone(admin, zone, { create, update, remove });
    done.push(zone.zoneName);
  }
  return { zones: done, currency };
}

// Turns on Picklo's delivery customization function (renames the pickup rate to the
// locker chosen in the cart widget). Only needed without CCS; with CCS it's a no-op.
async function ensureDeliveryCustomization(admin) {
  const data = await gql(admin, `{
    shopifyFunctions(first: 25, apiType: "delivery_customization") { nodes { id title } }
    deliveryCustomizations(first: 25) { nodes { id enabled functionId } }
  }`);
  const fn = data.shopifyFunctions.nodes[0]; // only this app's functions are returned
  if (!fn) return false;
  const existing = data.deliveryCustomizations.nodes.find((d) => d.functionId === fn.id || d.functionId?.endsWith(fn.id));
  if (existing?.enabled) return true;
  const res = existing
    ? await gql(admin, `mutation u($id: ID!, $c: DeliveryCustomizationInput!) {
        deliveryCustomizationUpdate(id: $id, deliveryCustomization: $c) { userErrors { message } } }`,
        { id: existing.id, c: { enabled: true } })
    : await gql(admin, `mutation c($c: DeliveryCustomizationInput!) {
        deliveryCustomizationCreate(deliveryCustomization: $c) { userErrors { message } } }`,
        { c: { functionId: fn.id, title: "Picklo — locker ales în coș", enabled: true } });
  const errors = (res.deliveryCustomizationUpdate || res.deliveryCustomizationCreate).userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return true;
}

// Detects the mode and sets checkout up. Safe to run repeatedly.
export async function setupCheckout(admin, shop) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) throw new Error("Shop not configured");
  const enabled = COURIERS.filter((c) => settings[`${c}Enabled`]);
  if (!enabled.length) throw new Error("Enable at least one courier first");

  const carrier = await ensureCarrierService(admin);
  let zones;
  let currency = null;
  if (carrier.mode === "ccs") zones = await attachCarrier(admin, carrier.carrierServiceId, enabled);
  else {
    ({ zones, currency } = await syncManualRates(admin, settings, enabled));
    await ensureDeliveryCustomization(admin);
  }

  await prisma.shopSettings.update({ where: { shop }, data: { checkoutMode: carrier.mode } });
  return { mode: carrier.mode, zones, currency, reason: carrier.reason };
}

// Keeps manual rates in step with the fees after the merchant saves settings
export async function resyncManualRatesIfNeeded(admin, shop) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (settings?.checkoutMode !== "manual") return null;
  const enabled = COURIERS.filter((c) => settings[`${c}Enabled`]);
  return enabled.length ? syncManualRates(admin, settings, enabled) : null;
}
