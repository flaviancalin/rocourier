// Ship-from locations: import from Shopify, pick the fulfilling location, sender override. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../app/db.server.js";
import { importShopifyLocations, resolveShipLocation, senderSettingsFor } from "../app/services/ship-locations.server.js";

const SHOP = "locations-test.myshopify.com";
const gql = (handlers) => ({ graphql: async (q) => ({ json: async () => handlers.find(([k]) => q.includes(k))[1] }) });
const LOCS = { data: { locations: { nodes: [
  { id: "gid://shopify/Location/1", name: "Depozit Cluj", address: { address1: "Str. Fabricii 2", city: "Cluj-Napoca", province: "Cluj", zip: "400000", countryCode: "RO", phone: "0711" } },
  { id: "gid://shopify/Location/2", name: "Furnizor Iasi", address: { address1: "Bd. Independentei 5", city: "Iasi", province: "Iasi", zip: "700000", countryCode: "RO" } },
] } } };
const FO = { data: { order: { fulfillmentOrders: { nodes: [
  { status: "OPEN", assignedLocation: { location: { id: "gid://shopify/Location/1" }, name: "Depozit Cluj" }, lineItems: { nodes: [{ remainingQuantity: 1 }] } },
  { status: "OPEN", assignedLocation: { location: { id: "gid://shopify/Location/2" }, name: "Furnizor Iasi" }, lineItems: { nodes: [{ remainingQuantity: 3 }] } },
] } } } };

test.before(async () => { await prisma.shipLocation.deleteMany({ where: { shop: SHOP } }); });
test.after(async () => { await prisma.shipLocation.deleteMany({ where: { shop: SHOP } }); await prisma.$disconnect(); });

test("locations: import keeps merchant edits on refresh", async () => {
  const admin = gql([["locations(", LOCS]]);
  assert.equal((await importShopifyLocations(admin, SHOP)).count, 2);
  const cluj = await prisma.shipLocation.findFirst({ where: { shop: SHOP, name: "Depozit Cluj" } });
  assert.equal(cluj.city, "Cluj-Napoca");
  await prisma.shipLocation.update({ where: { id: cluj.id }, data: { address: "Str. Corectata 9", phone: null } });
  await importShopifyLocations(admin, SHOP);
  const again = await prisma.shipLocation.findUnique({ where: { id: cluj.id } });
  assert.equal(again.address, "Str. Corectata 9");
  assert.equal(again.phone, "0711"); // empty fields are filled back
});

test("locations: AWB leaves from the location holding most items; explicit choice wins", async () => {
  const admin = gql([["fulfillmentOrders", FO]]);
  const order = { shopifyOrderId: "123" };
  assert.equal((await resolveShipLocation(admin, SHOP, order)).name, "Furnizor Iasi");
  const cluj = await prisma.shipLocation.findFirst({ where: { shop: SHOP, name: "Depozit Cluj" } });
  assert.equal((await resolveShipLocation(admin, SHOP, order, cluj.id)).name, "Depozit Cluj");
  await prisma.shipLocation.updateMany({ where: { shop: SHOP, name: "Furnizor Iasi" }, data: { active: false } });
  assert.equal((await resolveShipLocation(admin, SHOP, order)).name, "Depozit Cluj"); // inactive skipped
});

test("locations: sender override keeps store fields the location lacks", () => {
  const base = { senderName: "Magazin SRL", senderPhone: "0700", senderEmail: "a@b.ro", senderCity: "Bucuresti" };
  const s = senderSettingsFor(base, { id: "x", name: "Furnizor Iasi", city: "Iasi", phone: null, samedayPickupPointId: "77" });
  assert.equal(s.senderName, "Furnizor Iasi");
  assert.equal(s.senderCity, "Iasi");
  assert.equal(s.senderPhone, "0700");
  assert.equal(s._samedayPickupPointId, "77");
  assert.equal(senderSettingsFor(base, null), base);
});
