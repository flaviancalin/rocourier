// @ts-check
// Picklo cash-on-delivery guard: customers who refused parcels before don't see cash on
// delivery at checkout. Picklo keeps the list (hashed emails/phones) in an app-owned shop
// metafield; every other payment method stays available.
import { contactHash, normEmail, normPhone } from "./hash.js";

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

const NO_CHANGES = { operations: [] };
const COD_NAME = /ramburs|cash on delivery|\bcod\b|plata la livrare|plată la livrare|numerar la livrare|utánvét|dobírka|nachnahme/i;

/**
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const raw = input.shop?.metafield?.value;
  if (!raw) return NO_CHANGES;
  let list;
  try { list = new Set(JSON.parse(raw)); } catch (_) { return NO_CHANGES; }
  if (!list.size) return NO_CHANGES;

  const contacts = [];
  const email = normEmail(input.cart.buyerIdentity?.email);
  if (email) contacts.push(email);
  for (const p of [input.cart.buyerIdentity?.phone, ...input.cart.deliveryGroups.map((g) => g.deliveryAddress?.phone)]) {
    const n = normPhone(p);
    if (n.length === 9) contacts.push(n);
  }
  if (!contacts.some((c) => list.has(contactHash(c)))) return NO_CHANGES;

  return {
    operations: input.paymentMethods
      .filter((m) => COD_NAME.test(m.name))
      .map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } })),
  };
}
