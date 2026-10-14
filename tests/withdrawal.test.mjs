// Right of withdrawal (EU 2023/2673 / OUG 18/2026). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../app/db.server.js";
import { findOrderForWithdrawal, canWithdraw, createWithdrawal, withdrawalPage } from "../app/services/withdrawal.server.js";
import { wt, withdrawalRef, withdrawalDeadline } from "../app/utils/withdrawal.js";

const SHOP = "withdraw-test.myshopify.com";
let order;

test.before(async () => {
  await prisma.returnRequest.deleteMany({ where: { shop: SHOP } });
  await prisma.order.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.upsert({ where: { shop: SHOP }, update: { withdrawalEnabled: true, returnsWindowDays: 14 }, create: { shop: SHOP, withdrawalEnabled: true, returnsWindowDays: 14 } });
  order = await prisma.order.create({ data: { shop: SHOP, shopifyOrderId: "5550001", shopifyOrderName: "#5001", customerName: "Ana Pop", customerEmail: "ana@example.com",
    customerPhone: "0744 555 666", shippingCity: "Craiova", awbStatus: "delivered", deliveredAt: new Date(Date.now() - 3 * 864e5) } });
});

test("order lookup: number + email or phone must match", async () => {
  assert.equal((await findOrderForWithdrawal(SHOP, { orderName: "5001", contact: "ANA@example.com" })).verified, true);
  assert.equal((await findOrderForWithdrawal(SHOP, { orderName: "#5001", contact: "+40744555666" })).verified, true);
  assert.equal((await findOrderForWithdrawal(SHOP, { orderName: "5001", contact: "x@y.ro" })).error, "errContact");
  assert.equal((await findOrderForWithdrawal(SHOP, { orderName: "9999", contact: "ana@example.com" })).error, "errOrder");
  assert.equal((await findOrderForWithdrawal(SHOP, { oid: "5550001" })).verified, false);
});

test("logged-in customer of the order is trusted without the contact check", async () => {
  const admin = { graphql: async () => new Response(JSON.stringify({ data: { order: { customer: { id: "gid://shopify/Customer/77" } } } })) };
  assert.equal((await findOrderForWithdrawal(SHOP, { oid: "5550001", loggedInCustomerId: "77", admin })).verified, true);
  assert.equal((await findOrderForWithdrawal(SHOP, { oid: "5550001", loggedInCustomerId: "78", admin })).verified, false);
});

test("deadline: 14 days from delivery (or the longer return window); none before delivery", async () => {
  const d = new Date("2026-10-01T10:00:00Z");
  assert.equal(withdrawalDeadline({ deliveredAt: d }).toISOString(), "2026-10-15T10:00:00.000Z");
  assert.equal(withdrawalDeadline({ deliveredAt: d }, 30).toISOString(), "2026-10-31T10:00:00.000Z");
  assert.equal(withdrawalDeadline({ deliveredAt: null }), null);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(await canWithdraw(SHOP, order, settings), null);
  assert.equal(await canWithdraw(SHOP, { ...order, deliveredAt: new Date(Date.now() - 20 * 864e5) }, settings), "errExpired");
  assert.equal(await canWithdraw(SHOP, { ...order, shopifyCancelledAt: new Date() }, settings), "errCancelled");
  assert.equal(await canWithdraw(SHOP, order, { ...settings, withdrawalEnabled: false }), "errOff");
});

test("withdrawal is recorded with a reference, refund deadline and the Shopify tag; a second one is blocked", async () => {
  const calls = [];
  const admin = { graphql: async (q, o) => { calls.push({ q, o }); return new Response(JSON.stringify({ data: { tagsAdd: { userErrors: [] } } })); } };
  const r = await createWithdrawal(SHOP, order, { items: [{ name: "Ruj", quantity: 1 }], admin, lang: "ro" });
  assert.equal(r.rr.kind, "withdrawal");
  assert.match(r.ref, /^RTG-[A-Z0-9]{6}$/);
  assert.equal(r.ref, withdrawalRef(r.rr.id));
  assert.ok(Math.abs(new Date(r.rr.refundDueAt) - Date.now() - 14 * 864e5) < 60000);
  assert.equal(r.emailed, false); // no mail provider in tests
  assert.ok(calls.some((c) => c.q.includes("tagsAdd") && c.o.variables.tags.includes("retragere-contract")));
  const settings = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(await canWithdraw(SHOP, order, settings), "errOpen");
});

test("page: two steps (review, then confirm) and the acknowledgement", async () => {
  await prisma.returnRequest.deleteMany({ where: { shop: SHOP } });
  const admin = { graphql: async (q) => new Response(JSON.stringify({ data: q.includes("lineItems")
    ? { order: { lineItems: { nodes: [{ name: "Ruj", sku: "R1", quantity: 2, currentQuantity: 2 }] } } } : { tagsAdd: { userErrors: [] } } })) };
  const q = new URLSearchParams({ order: "5001", contact: "ana@example.com" });
  const choose = await withdrawalPage(SHOP, q, admin);
  assert.match(choose, /Retrage-te din contract/);
  const review = await withdrawalPage(SHOP, q, admin, { form: new URLSearchParams({ step: "review", all: "1", order: "5001", contact: "ana@example.com" }) });
  assert.match(review, /Confirmă retragerea/);
  const items = JSON.stringify([{ name: "Ruj", sku: "R1", quantity: 2 }]);
  const done = await withdrawalPage(SHOP, q, admin, { form: new URLSearchParams({ step: "confirm", items, order: "5001", contact: "ana@example.com" }) });
  assert.match(done, /Retragerea a fost înregistrată/);
  assert.match(done, /RTG-/);
  const en = await withdrawalPage(SHOP, new URLSearchParams({ lang: "en" }), admin);
  assert.match(en, /Withdraw from contract/);
  assert.equal(wt("hu", "title"), "Elállás a szerződéstől");
});
