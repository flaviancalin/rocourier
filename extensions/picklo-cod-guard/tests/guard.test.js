import { describe, it, expect } from "vitest";
import { cartPaymentMethodsTransformRun } from "../src/cart_payment_methods_transform_run.js";
import { contactHash } from "../src/hash.js";

const methods = [{ id: "pm_card", name: "Card" }, { id: "pm_cod", name: "Plata ramburs (la livrare)" }];
const input = (email, phone, list) => ({
  cart: { buyerIdentity: { email, phone }, deliveryGroups: [{ deliveryAddress: { phone } }] },
  paymentMethods: methods,
  shop: { metafield: list ? { value: JSON.stringify(list) } : null },
});

describe("cod guard", () => {
  it("does nothing without a blocklist", () => {
    expect(cartPaymentMethodsTransformRun(input("a@b.ro", null, null))).toEqual({ operations: [] });
  });
  it("hides only cash on delivery for a listed email", () => {
    const r = cartPaymentMethodsTransformRun(input("A@B.ro ", null, [contactHash("a@b.ro")]));
    expect(r).toEqual({ operations: [{ paymentMethodHide: { paymentMethodId: "pm_cod" } }] });
  });
  it("matches phones in any format", () => {
    const r = cartPaymentMethodsTransformRun(input(null, "+40 744 555 666", [contactHash("744555666")]));
    expect(r.operations).toHaveLength(1);
  });
  it("leaves other customers alone", () => {
    expect(cartPaymentMethodsTransformRun(input("x@y.ro", "0711111111", [contactHash("a@b.ro")]))).toEqual({ operations: [] });
  });
});
