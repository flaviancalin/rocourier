// Taking Picklo out of checkout. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { removeCheckout, setupCheckout, CARRIER_CALLBACK_URL } from "../app/services/checkout-setup.server.js";
import { prisma } from "../app/db.server.js";

function fakeAdmin(zoneMethods, { plusOnly = false } = {}) {
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
    else if (q.includes("{ shop { id } }")) data = { shop: { id: "gid://shopify/Shop/1" } };
    else if (q.includes("metafieldsSet")) data = { metafieldsSet: { userErrors: [] } };
    else if (q.includes("shopifyFunctions(")) data = { shopifyFunctions: { nodes: [{ id: "fn1" }] }, deliveryCustomizations: { nodes: plusOnly ? [] : [{ id: "dc1", enabled: true, functionId: "fn1" }] } };
    else if (q.includes("deliveryCustomizationCreate")) data = { deliveryCustomizationCreate: { userErrors: plusOnly ? [{ message: "Shop must be on a Shopify Plus plan to activate functions from a custom app." }] : [] } };
    else if (q.includes("carrierServiceCreate")) data = { carrierServiceCreate: { carrierService: { id: "cs1" }, userErrors: [] } };
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

test("widget style: fixed Picklo rates, carrier service taken out, style published for the function", async () => {
  await prisma.shopSettings.upsert({ where: { shop: "style-test.myshopify.com" },
    update: { checkoutStyle: "widget", fanEnabled: false, samedayEnabled: true, samedayHomeDeliveryFee: 19, samedayPickupFee: 12, checkoutMode: "ccs" },
    create: { shop: "style-test.myshopify.com", checkoutStyle: "widget", fanEnabled: false, samedayEnabled: true, samedayHomeDeliveryFee: 19, samedayPickupFee: 12, checkoutMode: "ccs" } });
  const { admin, calls } = fakeAdmin([["Domestic", [picklo, own]]]);
  const r = await setupCheckout(admin, "style-test.myshopify.com");
  assert.equal(r.mode, "manual");
  assert.equal(r.style, "widget");
  const meta = calls.find((c) => c.q.includes("metafieldsSet"));
  assert.deepEqual([meta.variables.m[0].key, meta.variables.m[0].value], ["checkout_style", "widget"]);
  const created = calls.filter((c) => c.q.includes("deliveryProfileUpdate")).flatMap((c) => c.variables.profile.locationGroupsToUpdate?.[0]?.zonesToUpdate?.[0]?.methodDefinitionsToCreate || []);
  assert.deepEqual(created.map((m) => [m.name, m.rateDefinition.price.amount]).sort(), [["Sameday easybox — Ridicare din punct", "12.00"], ["Sameday — Livrare la domiciliu", "19.00"]]);
  assert.ok(calls.some((c) => c.q.includes("carrierServiceDelete")));
});

test("widget style on a custom app without Plus: falls back to the carrier service, leftover fixed rates removed", async () => {
  const fixed = { id: "f1", name: "Sameday easybox — Ridicare din punct", active: true, rateProvider: { __typename: "DeliveryRateDefinition", id: "r1", price: { amount: "0" } } };
  const { admin, calls } = fakeAdmin([["Domestic", [fixed, own]]], { plusOnly: true });
  const r = await setupCheckout(admin, "style-test.myshopify.com");
  assert.equal(r.mode, "ccs");
  assert.equal(r.note, "functions_need_plus");
  const deletes = calls.filter((c) => c.q.includes("deliveryProfileUpdate")).flatMap((c) => c.variables.profile.methodDefinitionsToDelete || []);
  assert.ok(deletes.includes("f1"));
  // nothing priced as fixed Picklo rates was created
  const created = calls.filter((c) => c.q.includes("deliveryProfileUpdate")).flatMap((c) => c.variables.profile.locationGroupsToUpdate?.[0]?.zonesToUpdate?.[0]?.methodDefinitionsToCreate || []);
  assert.ok(created.every((m) => m.participant), JSON.stringify(created));
});
