// @ts-check
// Picklo delivery options for stores without carrier-calculated shipping.
// Picklo creates fixed rates such as "FANbox — Ridicare din punct". When the shopper
// already picked a locker in the cart widget, this renames that courier's pickup rate
// to the chosen locker ("FANbox — FANbox Oltet 20 DJ") and lists it first, so checkout
// shows exactly what they chose. Rates from the carrier service (codes "RC_…") are
// already specific and left untouched.

/**
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunInput} CartDeliveryOptionsTransformRunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

// Keep in sync with app/utils/couriers.js
const POINT_LABELS = {
  fan: "FANbox",
  sameday: "Sameday easybox",
  cargus: "Cargus Ship & Go",
  gls: "GLS ParcelShop",
  packeta: "Packeta / Z-BOX",
};

/** @type {CartDeliveryOptionsTransformRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * @param {CartDeliveryOptionsTransformRunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  const method = input.cart.method?.value;
  const courier = input.cart.courier?.value || "";
  const pointName = (input.cart.pointName?.value || "").trim();
  const label = POINT_LABELS[courier];
  if (method !== "pickup_point" || !pointName || !label) return NO_CHANGES;

  const operations = [];
  for (const group of input.cart.deliveryGroups) {
    const index = group.deliveryOptions.findIndex((o) =>
      !String(o.code || "").startsWith("RC_") && (o.title || "").startsWith(`${label} — `));
    if (index === -1) continue;
    const option = group.deliveryOptions[index];
    operations.push({ deliveryOptionRename: { deliveryOptionHandle: option.handle, title: `${label} — ${pointName}`.slice(0, 255) } });
    // Pickup points are exempt from the "cheapest option first" rule (App Store 1.1.10)
    if (index !== 0) operations.push({ deliveryOptionMove: { deliveryOptionHandle: option.handle, index: 0 } });
  }
  return { operations };
}
