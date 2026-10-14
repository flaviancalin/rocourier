// Automatic courier choice. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { chooseCourier, withFixedPrices } from "../app/services/courier-choice.server.js";

const base = { fanEnabled: true, samedayEnabled: true, glsEnabled: true, packetaEnabled: false, autoCourierMode: "cheapest", routingRules: [] };
const home = { shippingMethod: "home_delivery", courierType: "fan", shippingCounty: "Cluj", shippingCity: "Cluj-Napoca", weight: 1, codAmount: 100 };
const rates = [
  { courier: "fan", name: "FAN Courier", price: 19.5 },
  { courier: "sameday", name: "Sameday", price: 17.9 },
  { courier: "gls", name: "GLS", price: null, note: "fără API de tarife" },
  { courier: "packeta", name: "Packeta", price: 9 },
];

test("auto courier: cheapest connected courier, with the runner-up in the reason", async () => {
  const r = await chooseCourier(base, home, { rates });
  assert.equal(r.courier, "sameday"); // Packeta is cheaper but not enabled
  assert.match(r.reason, /cel mai ieftin: Sameday 17\.90 RON \(FAN Courier 19\.50 RON\)/);
});

test("auto courier: merchant price fills couriers without a price API", async () => {
  const s = { ...base, autoCourierPrices: { gls: 15 } };
  assert.equal((await chooseCourier(s, home, { rates })).courier, "gls");
  assert.equal(withFixedPrices(rates, s).find((x) => x.courier === "gls").source, "fixed");
});

test("auto courier: locker orders keep their courier, rules win, off does nothing", async () => {
  assert.equal((await chooseCourier(base, { ...home, shippingMethod: "pickup_point", pickupPointId: "X1", courierType: "fan" }, { rates })).courier, "fan");
  const ruled = await chooseCourier({ ...base, routingRules: [{ field: "county", value: "Cluj", courier: "fan" }] }, home, { rates });
  assert.equal(ruled.courier, "fan");
  assert.equal(ruled.reason, "regulă de curier");
  assert.equal((await chooseCourier({ ...base, autoCourierMode: "off" }, home, { rates })).courier, null);
  assert.equal((await chooseCourier(base, home, { rates: rates.map((x) => ({ ...x, price: null })) })).courier, null);
});
