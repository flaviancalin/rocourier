// app/services/dpd.server.js
// DPD Romania Web API v1 — https://api.dpd.ro/v1 (same platform as Speedy BG).
// Docs: https://api.dpd.ro/api/docs/ (copy in docs/api/dpd). Every call is a POST with
// userName/password in the JSON body; errors come back as { error: { code, message } }.
// Test accounts: request one from DPD Romania by email (see docs/api/dpd).
//
// Lockers: DPD offices have type "OFFICE" or "APT" (APT = DPDbox locker). Both are
// self-collection points; the recipient is set with `pickupOfficeId` instead of an address.
import { normalizeName, normalizeRoPhone, normalizeRoCounty, parseRoStreet } from "../utils/address.js";

const DPD_BASE = (process.env.DPD_API_BASE || "https://api.dpd.ro/v1").replace(/\/$/, "");
export const DPD_COUNTRY_RO = 642;

export class DpdError extends Error {
  constructor(message, code = null) { super(message); this.code = code; }
}

async function dpdRequest(path, { username, password, ...body }, { binary = false } = {}) {
  if (!username || !password) throw new DpdError("DPD: credențiale lipsă (utilizator și parolă API)");
  const res = await fetch(`${DPD_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: binary ? "application/pdf, application/json" : "application/json" },
    body: JSON.stringify({ userName: username, password, language: "RO", ...body }),
  });

  const type = res.headers.get("content-type") || "";
  if (binary && !type.includes("json")) {
    if (!res.ok) throw new DpdError(`DPD [${res.status}]`);
    return Buffer.from(await res.arrayBuffer());
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new DpdError(`DPD [${res.status}]: ${text.slice(0, 200)}`); }
  if (data?.error) {
    const { code, message, context } = data.error;
    throw new DpdError(`DPD${code != null ? ` [${code}]` : ""}: ${message || "eroare necunoscută"}${context ? ` (${context})` : ""}`, code);
  }
  if (!res.ok) throw new DpdError(`DPD [${res.status}]: ${text.slice(0, 200)}`);
  return data;
}

// ── Account ──────────────────────────────────────────────────────────────────
// Contract clients = the merchant's pickup addresses (warehouse, shop…). The first one is the default sender.
export async function dpdGetContractClients({ username, password }) {
  const data = await dpdRequest("client/contract", { username, password });
  return (data.clients || []).map((c) => ({
    clientId: c.clientId,
    name: [c.clientName, c.objectName].filter(Boolean).join(" — "),
    address: c.address?.fullAddressString || "",
  }));
}

export async function dpdTestConnection({ username, password }) {
  const clients = await dpdGetContractClients({ username, password });
  return { success: true, clients };
}

export async function dpdGetServices({ username, password }) {
  const data = await dpdRequest("services", { username, password });
  return (data.services || [])
    .filter((s) => !s.cargoType || s.cargoType === "PARCEL")
    .map((s) => ({ id: s.id, name: s.name || s.nameEn, nameEn: s.nameEn, cod: s.additionalServices?.cod?.allowance || null }));
}

// Picks the domestic parcel service when the merchant hasn't chosen one.
export function pickDefaultService(services = []) {
  const domestic = services.filter((s) => !/international|export|pallet|palet/i.test(`${s.name} ${s.nameEn}`));
  return (
    domestic.find((s) => /standard|classic|clasic/i.test(`${s.name} ${s.nameEn}`)) ||
    domestic[0] || services[0] || null
  );
}

// ── Places ───────────────────────────────────────────────────────────────────
// Finds the DPD site (locality) for a Romanian city. Postcode narrows it to one site
// when the city name is shared by several villages in different counties.
export async function dpdFindSite({ username, password, city, county, postCode }) {
  const queries = [];
  if (postCode) queries.push({ postCode: String(postCode).trim() });
  if (city) queries.push({ name: String(city).trim() });

  const wantCity = normalizeName(city);
  const wantCounty = normalizeName(normalizeRoCounty(county));
  for (const q of queries) {
    const data = await dpdRequest("location/site", { username, password, countryId: DPD_COUNTRY_RO, ...q });
    const sites = data.sites || [];
    if (!sites.length) continue;
    const score = (s) =>
      (wantCity && normalizeName(s.name) === wantCity ? 4 : 0) +
      (wantCounty && normalizeName(s.region).includes(wantCounty) ? 2 : 0) +
      (postCode && s.postCode === String(postCode).trim() ? 1 : 0);
    const best = [...sites].sort((a, b) => score(b) - score(a))[0];
    if (best && (sites.length === 1 || score(best) >= 2)) return best;
  }
  return null;
}

// Converts an office (or locker) from the API into our PickupPoint row shape.
export function officeToPickupPoint(o) {
  const a = o.address || {};
  return {
    externalId: String(o.id),
    courier: "dpd",
    name: o.type === "APT" ? `DPDbox ${o.name}` : o.name,
    address: a.fullAddressString || [a.localAddressString, a.siteAddressString].filter(Boolean).join(", "),
    city: a.siteName || null,
    county: a.stateName || (a.siteAddressString?.match(/jud(?:\.|etul)?\s+([^,]+)/i)?.[1]?.trim() ?? null),
    zip: a.postCode || null,
    lat: typeof a.y === "number" ? a.y : null,
    lng: typeof a.x === "number" ? a.x : null,
    type: o.type === "APT" ? "dpdbox" : "dpd_office",
    country: "ro",
  };
}

// All Romanian pickup offices + DPDbox lockers that accept parcels for self-collection.
export async function dpdGetPickupPoints({ username, password }) {
  const data = await dpdRequest("location/office", { username, password, countryId: DPD_COUNTRY_RO });
  return (data.offices || [])
    .filter((o) => o.pickUpAllowed !== false && (!o.cargoTypesAllowed || o.cargoTypesAllowed.includes("PARCEL")))
    .map(officeToPickupPoint);
}

// ── Shipments ────────────────────────────────────────────────────────────────
function buildRecipientAddress(site, order) {
  const street = parseRoStreet([order.shippingAddress1, order.shippingAddress2].filter(Boolean).join(", "));
  const fullNote = [order.shippingAddress1, order.shippingAddress2].filter(Boolean).join(", ").slice(0, 200);
  const address = { countryId: DPD_COUNTRY_RO, siteId: site.id };
  if (order.shippingZip) address.postCode = String(order.shippingZip).trim();
  // DPD processes the address automatically only when street + number (or block) are given;
  // otherwise everything goes in addressNote and is read by a person.
  if (street.streetName && (street.streetNo || street.blockNo)) {
    if (street.streetType) address.streetType = street.streetType;
    address.streetName = street.streetName.slice(0, 50);
    if (street.streetNo) address.streetNo = street.streetNo;
    if (street.blockNo) address.blockNo = street.blockNo;
    if (street.entranceNo) address.entranceNo = street.entranceNo;
    if (street.floorNo) address.floorNo = street.floorNo;
    if (street.apartmentNo) address.apartmentNo = street.apartmentNo;
    if (street.rest) address.addressNote = street.rest.slice(0, 200);
  } else {
    address.addressNote = fullNote;
  }
  return address;
}

export async function dpdCreateAwb({
  username, password,
  order,                    // Picklo order data (customer*, shipping*, codAmount, weight, packageCount, shopifyOrderName)
  settings,                 // ShopSettings (dpdServiceId, dpdClientId, senderName, senderPhone…)
  pickupOfficeId = null,    // DPD office / DPDbox id → self-collection
  serviceId = null,
  observations = null,
  openPackage = false,
  declaredValue = 0,
  shipmentPayer = "recipient",
  saturdayDelivery = false,
}) {
  if (!order.customerName) throw new DpdError("DPD AWB: lipsește numele destinatarului.");
  const phone = normalizeRoPhone(order.customerPhone);
  if (!phone) throw new DpdError(`DPD AWB: telefonul destinatarului nu e valid (${order.customerPhone || "gol"}).`);

  let svc = parseInt(serviceId || settings.dpdServiceId) || null;
  if (!svc) svc = pickDefaultService(await dpdGetServices({ username, password }))?.id;
  if (!svc) throw new DpdError("DPD AWB: niciun serviciu disponibil pe contract. Alege serviciul în Setări → DPD.");

  const recipient = {
    privatePerson: true,
    clientName: String(order.customerName).slice(0, 60),
    phone1: { number: phone },
    ...(order.customerEmail ? { email: order.customerEmail } : {}),
  };
  if (pickupOfficeId) {
    recipient.pickupOfficeId = parseInt(pickupOfficeId);
  } else {
    const site = await dpdFindSite({ username, password, city: order.shippingCity, county: order.shippingCounty, postCode: order.shippingZip });
    if (!site) throw new DpdError(`DPD AWB: localitatea „${order.shippingCity}" (${order.shippingCounty || "-"}) nu a fost găsită în nomenclatorul DPD. Corectează localitatea sau codul poștal.`);
    recipient.address = buildRecipientAddress(site, order);
  }

  const cod = Number(order.codAmount) || 0;
  const additionalServices = {};
  if (cod > 0) additionalServices.cod = { amount: Math.round(cod * 100) / 100, processingType: "CASH" };
  if (declaredValue > 0) additionalServices.declaredValue = { amount: declaredValue };
  if (openPackage && !pickupOfficeId) additionalServices.obpd = { option: "OPEN", returnShipmentServiceId: svc, returnShipmentPayer: "SENDER" };

  const senderPhone = normalizeRoPhone(settings.senderPhone);
  const sender = {
    ...(settings.dpdClientId ? { clientId: parseInt(settings.dpdClientId) } : {}),
    ...(senderPhone ? { phone1: { number: senderPhone } } : {}),
    ...(settings.senderName ? { contactName: String(settings.senderName).slice(0, 60) } : {}),
    ...(settings.senderEmail ? { email: settings.senderEmail } : {}),
  };

  const parcels = Math.max(1, parseInt(order.packageCount) || 1);
  const body = {
    ...(Object.keys(sender).length ? { sender } : {}),
    recipient,
    service: {
      serviceId: svc,
      autoAdjustPickupDate: true,
      ...(saturdayDelivery ? { saturdayDelivery: true } : {}),
      ...(Object.keys(additionalServices).length ? { additionalServices } : {}),
    },
    content: {
      parcelsCount: parcels,
      totalWeight: Math.max(0.1, Number(order.weight) || 1),
      contents: (observations || `Comanda ${order.shopifyOrderName || ""}`).slice(0, 100),
      package: "BOX",
    },
    payment: {
      courierServicePayer: shipmentPayer === "sender" ? "SENDER" : "RECIPIENT",
      ...(declaredValue > 0 ? { declaredValuePayer: shipmentPayer === "sender" ? "SENDER" : "RECIPIENT" } : {}),
    },
    ref1: String(order.shopifyOrderName || "").slice(0, 30),
    ...(observations ? { shipmentNote: String(observations).slice(0, 200) } : {}),
  };

  const data = await dpdRequest("shipment", { username, password, ...body });
  if (!data.id) throw new DpdError("DPD AWB: răspuns fără număr de expediție.");
  return {
    success: true,
    awbNumber: String(data.id),
    parcelIds: (data.parcels || []).map((p) => String(p.id)),
    price: data.price?.total ?? null,
    deliveryDeadline: data.deliveryDeadline || null,
  };
}

// Labels for one shipment (all its parcels). paperSize: "A6" | "A4" | "A4_4xA6".
export async function dpdPrintAwb({ username, password, awbNumber, parcelIds = [], paperSize = "A6" }) {
  const ids = parcelIds.length ? parcelIds : [String(awbNumber)];
  return dpdRequest("print", { username, password, paperSize, parcels: ids.map((id) => ({ parcel: { id } })) }, { binary: true });
}

export async function dpdDeleteAwb({ username, password, awbNumber }) {
  await dpdRequest("shipment/cancel", { username, password, shipmentId: String(awbNumber), comment: "Anulat din Picklo" });
  return { success: true };
}

// ── Tracking ─────────────────────────────────────────────────────────────────
// Operation codes from Appendix 1 of the DPD docs → Picklo statuses.
const DPD_STATUS = {
  148: "generated",          // shipment data received
  39: "picked_up",           // courier pick-up
  1: "in_transit", 2: "in_transit", 21: "in_transit", 152: "in_transit", 116: "in_transit", 115: "in_transit",
  11: "in_transit",          // received in office
  12: "out_for_delivery",
  134: "out_for_delivery",   // ready for self-collection (office / DPDbox)
  1134: "out_for_delivery",  // notification sent for parcel in office/locker
  [-14]: "delivered",
  44: "failed", 190: "failed", 136: "failed", 169: "failed",
  123: "returned", 111: "returned", 124: "returned",
  128: "cancelled",
};

export function dpdStatusFromCode(code) {
  return DPD_STATUS[Number(code)] || null;
}

export async function dpdTrackAwb({ username, password, awbNumber }) {
  const data = await dpdRequest("track", { username, password, parcels: [{ id: String(awbNumber) }] });
  const parcel = (data.parcels || [])[0];
  if (parcel?.error) throw new DpdError(`DPD: ${parcel.error.message}`, parcel.error.code);
  return (parcel?.operations || []).map((op) => ({
    code: String(op.operationCode),
    description: op.description || "",
    date: new Date(op.dateTime),
    location: op.place || null,
    status: dpdStatusFromCode(op.operationCode),
  }));
}

// ── Customer return: picked up from the customer, delivered to the merchant ──
export async function dpdCreateReturnAwb({ username, password, settings, from, weight = 1, parcels = 1, reference = "", note = "" }) {
  const phone = normalizeRoPhone(from.phone);
  if (!phone) throw new DpdError(`DPD retur: telefonul clientului nu e valid (${from.phone || "gol"}).`);
  const site = await dpdFindSite({ username, password, city: from.city, county: from.county, postCode: from.zip });
  if (!site) throw new DpdError(`DPD retur: localitatea „${from.city}" nu a fost găsită.`);

  let merchantClientId = parseInt(settings.dpdClientId) || null;
  if (!merchantClientId) merchantClientId = (await dpdGetContractClients({ username, password }))[0]?.clientId || null;
  if (!merchantClientId) throw new DpdError("DPD retur: nu am găsit adresa magazinului pe contractul DPD.");

  let svc = parseInt(settings.dpdServiceId) || pickDefaultService(await dpdGetServices({ username, password }))?.id;
  const data = await dpdRequest("shipment", {
    username, password,
    sender: {
      privatePerson: true,
      clientName: String(from.name || "Client").slice(0, 60),
      phone1: { number: phone },
      ...(from.email ? { email: from.email } : {}),
      address: buildRecipientAddress(site, { shippingAddress1: from.address, shippingZip: from.zip }),
    },
    recipient: { clientId: merchantClientId },
    service: { serviceId: svc, autoAdjustPickupDate: true },
    content: { parcelsCount: Math.max(1, parcels), totalWeight: Math.max(0.1, Number(weight) || 1), contents: `Retur ${reference}`.slice(0, 100), package: "BOX" },
    payment: { courierServicePayer: "RECIPIENT" },
    ref1: `RETUR ${reference}`.slice(0, 30),
    ...(note ? { shipmentNote: String(note).slice(0, 200) } : {}),
  });
  if (!data.id) throw new DpdError("DPD retur: răspuns fără număr de expediție.");
  return { success: true, awbNumber: String(data.id) };
}

// ── Pickup request (courier comes to collect today's parcels) ────────────────
export async function dpdRequestPickup({ username, password, awbNumbers, visitEndTime = "17:00", contactName, phone }) {
  const data = await dpdRequest("pickup", {
    username, password,
    autoAdjustPickupDate: true,
    pickupScope: "EXPLICIT_SHIPMENT_ID_LIST",
    explicitShipmentIdList: awbNumbers.map(String),
    visitEndTime,
    ...(contactName ? { contactName } : {}),
    ...(normalizeRoPhone(phone) ? { phoneNumber: { number: normalizeRoPhone(phone) } } : {}),
  });
  return (data.orders || []).map((o) => ({ id: o.id, pickupPeriodFrom: o.pickupPeriodFrom, pickupPeriodTo: o.pickupPeriodTo }));
}

// ── Price ────────────────────────────────────────────────────────────────────
export async function dpdCalculatePrice({ username, password, serviceId, city, county, postCode, pickupOfficeId, weight = 1, codAmount = 0, parcels = 1 }) {
  const recipient = { privatePerson: true };
  if (pickupOfficeId) recipient.pickupOfficeId = parseInt(pickupOfficeId);
  else {
    const site = await dpdFindSite({ username, password, city, county, postCode });
    if (!site) throw new DpdError(`DPD: localitatea „${city}" nu a fost găsită.`);
    recipient.addressLocation = { siteId: site.id };
  }
  const data = await dpdRequest("calculate", {
    username, password,
    recipient,
    service: {
      serviceIds: [parseInt(serviceId)],
      autoAdjustPickupDate: true,
      ...(codAmount > 0 ? { additionalServices: { cod: { amount: codAmount, processingType: "CASH" } } } : {}),
    },
    content: { parcelsCount: parcels, totalWeight: Math.max(0.1, Number(weight) || 1) },
    payment: { courierServicePayer: "SENDER" },
  });
  const r = (data.calculations || [])[0];
  if (r?.error) throw new DpdError(`DPD: ${r.error.message}`, r.error.code);
  return { total: r?.price?.total ?? null, currency: r?.price?.currency || "RON", deliveryDeadline: r?.deliveryDeadline || null };
}

// ── COD payouts (ramburs) ────────────────────────────────────────────────────
// Returns one row per shipment paid out in the period, ready for reconciliation.
export async function dpdGetCodPayouts({ username, password, from, to }) {
  const fmt = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "+0000");
  const data = await dpdRequest("payments", { username, password, fromDate: fmt(from), toDate: fmt(to), includeDetails: true });
  const rows = [];
  for (const p of data.payouts || []) {
    for (const d of p.details || []) {
      rows.push({
        awbNumber: String(d.shipmentId),
        amount: Number(d.amount) || 0,
        currency: d.currency || p.currency || "RON",
        paidAt: p.date ? new Date(p.date) : null,
        reference: d.ref1 || null,
        documentId: p.docId != null ? String(p.docId) : null,
      });
    }
  }
  return rows;
}
