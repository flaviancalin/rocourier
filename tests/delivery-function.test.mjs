// Picklo delivery function: checkout narrowed to the cart widget choice. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { cartDeliveryOptionsTransformRun as run } from "../extensions/picklo-delivery-options/src/cart_delivery_options_transform_run.js";

const options = [
  { handle: "own", title: "Transport Curier (GLS)", code: "own", cost: { amount: "0" } },
  { handle: "sd-home", title: "Sameday — Livrare la domiciliu", code: "x", cost: { amount: "19" } },
  { handle: "sd-box", title: "Sameday easybox — Ridicare din punct", code: "x", cost: { amount: "12" } },
  { handle: "gls-home", title: "GLS — Livrare la domiciliu", code: "x", cost: { amount: "21" } },
  { handle: "gls-box", title: "GLS ParcelShop — Ridicare din punct", code: "x", cost: { amount: "13" } },
];
const input = (attrs, style) => ({
  shop: { style: style ? { value: style } : null },
  cart: { method: attrs.method ? { value: attrs.method } : null, courier: attrs.courier ? { value: attrs.courier } : null,
    pointName: attrs.point ? { value: attrs.point } : null, deliveryGroups: [{ deliveryOptions: options }] },
});
const hidden = (r) => r.operations.filter((o) => o.deliveryOptionHide).map((o) => o.deliveryOptionHide.deliveryOptionHandle).sort();

test("widget style, easybox chosen: only that locker stays, renamed; the store's own rate is hidden", () => {
  const r = run(input({ method: "pickup_point", courier: "sameday", point: "easybox Castanilor" }, "widget"));
  assert.deepEqual(r.operations.find((o) => o.deliveryOptionRename).deliveryOptionRename, { deliveryOptionHandle: "sd-box", title: "Sameday easybox — easybox Castanilor" });
  assert.deepEqual(hidden(r), ["gls-box", "gls-home", "own", "sd-home"]);
});

test("widget style, GLS home chosen: only GLS home stays", () => {
  assert.deepEqual(hidden(run(input({ method: "home_delivery", courier: "gls" }, "widget"))), ["gls-box", "own", "sd-box", "sd-home"]);
});

test("widget style, no matching Picklo rate: nothing is hidden", () => {
  assert.deepEqual(run(input({ method: "home_delivery", courier: "fan" }, "widget")).operations, []);
});

test("list style keeps the old behaviour: home choice changes nothing, locker hides only other couriers' pickup rates", () => {
  assert.deepEqual(run(input({ method: "home_delivery", courier: "gls" }, "list")).operations, []);
  assert.deepEqual(hidden(run(input({ method: "pickup_point", courier: "sameday", point: "easybox X" }))), ["gls-box"]);
});
