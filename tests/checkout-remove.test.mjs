// Taking Picklo out of checkout. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { removeCheckout, CARRIER_CALLBACK_URL } from "../app/services/checkout-setup.server.js";
import { prisma } from "../app/db.server.js";

function fakeAdmin(zoneMethods) {
  const calls = [];
  const admin = { graphql: async (q, { variables } = {}) => {
    calls.push({ q, variables });
    let data;
    if (q.includes("carrierServices(")) data = { carrierServices: { nodes: [{ id: "cs1", callbackUrl: CARRIER_CALLBACK_URL }] } };
    else if (q.includes("deliveryProfiles(")) data = { shop: { currencyCode: "RON" }, deliveryProfiles: { nodes: [{ id: "p1", name: "General", default: true, profileLocationGroups: [{ locationGroup: { id: "g1" },
      locationGroupZones: { nodes: zoneMethods.map(([name, methods], i) => ({ zone: { id: `z${i}`, name, countries: [{ code: { countryCode: "RO" } }] }, methodDefinitions: { nodes: methods } })) } }] }] } };
    else if (q.includes("nodes(ids")) data = { nodes: [] };
    else if (q.includes("deliveryProfileUpdate")) data = { deliveryProfileUpdate: { profile: { id: "p1" }, userErrors: [] } };
    else if (q.includes("carrierServiceDelete")) data = { carrierServiceDelete: { deletedId: "cs1", userErrors: [] } };
    else if (q.includes("deliveryCustomizations(")) data = { deliveryCustomizations: { nodes: [{ id: "dc1", enabled: true, title: "Picklo — locker ales în coș" }] } };
    else data = { deliveryCustomizationUpdate: { userErrors: [] } };
    return new Response(JSON.stringify({ data }));
  } };
  return { admin, calls };
}
const picklo = { id: "m1", name: "Picklo", active: true, rateProvider: { __typename: "DeliveryParticipant", carrierService: { id: "cs1" } } };
const own = { id: "m2", name: "Livrare standard", active: true, rateProvider: { __typename: "DeliveryRateDefinition", id: "r", price: { amount: "19" } } };

test("removes Picklo rates and the carrier service, keeps the merchant's rates", async () => {
  await prisma.shopSettings.upsert({ where: { shop: "rm-test.myshopify.com" }, update: { checkoutMode: "ccs" }, create: { shop: "rm-test.myshopify.com", checkoutMode: "ccs" } });
  const { admin, calls } = fakeAdmin([["Domestic", [picklo, own]]]);
  const r = await removeCheckout(admin, "rm-test.myshopify.com");
  assert.deepEqual(r, { cleaned: ["Domestic"], skipped: [], carrierRemoved: true });
  const upd = calls.find((c) => c.q.includes("deliveryProfileUpdate"));
  assert.deepEqual(upd.variables.profile.methodDefinitionsToDelete, ["m1"]);
  assert.ok(calls.some((c) => c.q.includes("carrierServiceDelete")));
  assert.equal((await prisma.shopSettings.findUnique({ where: { shop: "rm-test.myshopify.com" } })).checkoutMode, null);
});

test("a zone where Picklo is the only option is left alone, and so is the carrier service", async () => {
  const { admin, calls } = fakeAdmin([["Domestic", [picklo, own]], ["Aria 1 GLS", [{ ...picklo, id: "m3" }]]]);
  const r = await removeCheckout(admin, "rm-test.myshopify.com");
  assert.deepEqual(r.skipped, ["Aria 1 GLS"]);
  assert.equal(r.carrierRemoved, false);
  assert.ok(!calls.some((c) => c.q.includes("carrierServiceDelete")));
});
