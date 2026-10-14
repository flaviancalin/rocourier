// app/services/ship-locations.server.js — shipping from several Shopify locations (warehouses,
// shops, dropshipping suppliers). Each location carries its own sender details; the AWB is
// sent from the location Shopify assigned the order to, or the one picked in the AWB wizard.
import { prisma } from "../db.server.js";

const SENDER_FIELDS = ["senderName", "senderPhone", "senderEmail", "senderAddress", "senderCity", "senderCounty", "senderZip"];

// Imports (or refreshes) the store's Shopify locations; fields edited in Picklo are kept
export async function importShopifyLocations(admin, shop) {
  const res = await admin.graphql(`{ locations(first: 50, includeInactive: false) { nodes { id name isActive
    address { address1 address2 city province zip countryCode phone } } } }`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  const nodes = body.data?.locations?.nodes || [];
  for (const l of nodes) {
    const a = l.address || {};
    const fromShopify = {
      name: l.name, address: [a.address1, a.address2].filter(Boolean).join(", ") || null, city: a.city || null,
      county: a.province || null, zip: a.zip || null, country: a.countryCode || "RO", phone: a.phone || null,
    };
    const existing = await prisma.shipLocation.findUnique({ where: { shop_shopifyLocationId: { shop, shopifyLocationId: l.id } } });
    if (!existing) {
      await prisma.shipLocation.create({ data: { shop, shopifyLocationId: l.id, ...fromShopify } });
    } else {
      // Only fill what's empty: the merchant may have corrected the sender details
      const fill = Object.fromEntries(Object.entries(fromShopify).filter(([k, v]) => v && !existing[k]));
      if (Object.keys(fill).length) await prisma.shipLocation.update({ where: { id: existing.id }, data: fill });
    }
  }
  return { count: nodes.length };
}

export const listShipLocations = (shop) => prisma.shipLocation.findMany({ where: { shop }, orderBy: [{ active: "desc" }, { name: "asc" }] });

// Locations the order's items are assigned to in Shopify (fulfillment orders), most items first
export async function orderLocations(admin, order) {
  try {
    const res = await admin.graphql(`query ($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { status
      assignedLocation { location { id } name } lineItems(first: 100) { nodes { remainingQuantity } } } } } }`,
      { variables: { id: `gid://shopify/Order/${order.shopifyOrderId}` } });
    const nodes = (await res.json()).data?.order?.fulfillmentOrders?.nodes || [];
    const byLoc = new Map();
    for (const fo of nodes) {
      if (["CLOSED", "CANCELLED"].includes(fo.status)) continue;
      const id = fo.assignedLocation?.location?.id;
      if (!id) continue;
      const qty = (fo.lineItems?.nodes || []).reduce((s, li) => s + (li.remainingQuantity || 0), 0);
      const cur = byLoc.get(id) || { shopifyLocationId: id, name: fo.assignedLocation.name, items: 0 };
      cur.items += qty;
      byLoc.set(id, cur);
    }
    return [...byLoc.values()].sort((a, b) => b.items - a.items);
  } catch (e) {
    console.error("[locations] fulfillment orders:", e.message || e);
    return [];
  }
}

// The location an AWB leaves from: explicit choice, else the one with most of the order's items
export async function resolveShipLocation(admin, shop, order, chosenId = null) {
  if (chosenId) return prisma.shipLocation.findFirst({ where: { shop, id: chosenId, active: true } });
  const locs = admin ? await orderLocations(admin, order) : [];
  for (const l of locs) {
    const found = await prisma.shipLocation.findFirst({ where: { shop, shopifyLocationId: l.shopifyLocationId, active: true } });
    if (found) return found;
  }
  return null;
}

// Store settings with the location as sender (couriers read the sender from settings)
export function senderSettingsFor(settings, location) {
  if (!location) return settings;
  const loc = {
    senderName: location.contactName ? `${location.name}` : location.name, senderPhone: location.phone, senderEmail: location.email,
    senderAddress: location.address, senderCity: location.city, senderCounty: location.county, senderZip: location.zip,
  };
  const merged = { ...settings };
  for (const f of SENDER_FIELDS) if (loc[f]) merged[f] = loc[f];
  merged.senderContactName = location.contactName || null;
  merged._samedayPickupPointId = location.samedayPickupPointId || null;
  merged._cargusLocationId = location.cargusLocationId || null;
  merged._shipLocationId = location.id;
  return merged;
}
