// app/services/cod-guard.server.js
// Refusal protection: customers with N refused/returned parcels lose cash on delivery
// at checkout (extensions/picklo-cod-guard). The function reads an app-owned shop
// metafield holding hashes of their emails/phones — never the contacts themselves.
import { prisma } from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";

// Same hash as extensions/picklo-cod-guard/src/hash.js
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export const contactHash = (s) => fnv1a(s, 2166136261) + fnv1a(s, 0x9e3779b9);
const normEmail = (e) => String(e || "").trim().toLowerCase();
const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-9);

// Hashes of every contact with at least `threshold` refused/returned parcels.
export async function buildBlocklist(shop, threshold) {
  if (!threshold || threshold < 1) return [];
  const rows = await prisma.order.findMany({
    where: { shop, awbStatus: "returned" },
    select: { customerEmail: true, customerPhone: true },
  });
  const counts = new Map();
  for (const r of rows) {
    const keys = new Set([normEmail(r.customerEmail), normPhone(r.customerPhone)].filter((k) => k && (k.includes("@") || k.length === 9)));
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].filter(([, n]) => n >= threshold).map(([k]) => contactHash(k)).sort();
}

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

// Turns the payment customization on once (no-op if it already exists).
async function ensurePaymentCustomization(admin) {
  const data = await gql(admin, `{
    shopifyFunctions(first: 25, apiType: "payment_customization") { nodes { id title app { title } } }
    paymentCustomizations(first: 25) { nodes { id title enabled functionId } }
  }`);
  const fn = data.shopifyFunctions.nodes.find((f) => /picklo/i.test(`${f.title} ${f.app?.title}`));
  if (!fn) return { error: "Funcția Picklo de plată nu e încă instalată (deploy necesar)." };
  const existing = data.paymentCustomizations.nodes.find((p) => p.functionId === fn.id);
  if (existing?.enabled) return { id: existing.id };
  if (existing) {
    await gql(admin, `mutation ($id: ID!) { paymentCustomizationActivation(ids: [$id], enabled: true) { userErrors { message } } }`, { id: existing.id });
    return { id: existing.id };
  }
  const created = await gql(admin, `mutation ($c: PaymentCustomizationInput!) {
    paymentCustomizationCreate(paymentCustomization: $c) { paymentCustomization { id } userErrors { message } }
  }`, { c: { functionId: fn.id, title: "Picklo — fără ramburs pentru clienții cu refuzuri", enabled: true } });
  const err = created.paymentCustomizationCreate.userErrors[0];
  if (err) return { error: err.message };
  return { id: created.paymentCustomizationCreate.paymentCustomization.id };
}

// Recomputes the blocklist and pushes it to the store.
export async function syncCodGuard(shop, adminClient = null) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { blockCodAfterRefusals: true } });
  const threshold = settings?.blockCodAfterRefusals || 0;
  const admin = adminClient || (await unauthenticated.admin(shop)).admin;
  const list = await buildBlocklist(shop, threshold);

  const owner = (await gql(admin, `{ shop { id } }`)).shop.id;
  const set = await gql(admin, `mutation ($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, {
    m: [{ ownerId: owner, namespace: "$app:picklo", key: "cod_blocklist", type: "json", value: JSON.stringify(list) }],
  });
  const err = set.metafieldsSet.userErrors[0];
  if (err) throw new Error(err.message);

  const customization = threshold > 0 ? await ensurePaymentCustomization(admin) : null;
  return { blocked: list.length, customization };
}
