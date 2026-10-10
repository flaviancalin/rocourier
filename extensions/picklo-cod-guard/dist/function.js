// extensions/picklo-cod-guard/node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
  try {
    ShopifyFunction;
  } catch (e) {
    throw new Error(
      "ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI."
    );
  }
  const input_obj = ShopifyFunction.readInput();
  const output_obj = userfunction(input_obj);
  ShopifyFunction.writeOutput(output_obj);
}

// extensions/picklo-cod-guard/src/hash.js
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
var contactHash = (s) => fnv1a(s, 2166136261) + fnv1a(s, 2654435769);
var normEmail = (e) => String(e || "").trim().toLowerCase();
var normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-9);

// extensions/picklo-cod-guard/src/cart_payment_methods_transform_run.js
var NO_CHANGES = { operations: [] };
var COD_NAME = /ramburs|cash on delivery|\bcod\b|plata la livrare|plată la livrare|numerar la livrare|utánvét|dobírka|nachnahme/i;
function cartPaymentMethodsTransformRun(input) {
  const raw = input.shop?.metafield?.value;
  if (!raw) return NO_CHANGES;
  let list;
  try {
    list = new Set(JSON.parse(raw));
  } catch (_) {
    return NO_CHANGES;
  }
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
    operations: input.paymentMethods.filter((m) => COD_NAME.test(m.name)).map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } }))
  };
}

// <stdin>
function cartPaymentMethodsTransformRun2() {
  return run_default(cartPaymentMethodsTransformRun);
}
export {
  cartPaymentMethodsTransformRun2 as cartPaymentMethodsTransformRun
};
