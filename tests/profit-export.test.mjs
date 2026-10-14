// Profit per order and the accounting export. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../app/db.server.js";
import { computeProfit, storeVatRate, syncOrderFinancials } from "../app/services/profit.server.js";
import { salesCsv, codCsv, sagaReceiptsXml, sagaInvoicesXml, monthRange } from "../app/services/accounting-export.server.js";

const SHOP = "profit-test.myshopify.com";
const settings = { invoiceProvider: "smartbill", smartbillTVA: "21", paymentFeePercent: 2 };

test("profit: VAT payer, COD order with courier cost and product cost", () => {
  const p = computeProfit({ orderTotal: 121, taxAmount: 21, codAmount: 121, shippingCost: 24.2, cogsAmount: 40, awbStatus: "delivered", profitSyncedAt: new Date() }, settings);
  assert.deepEqual([p.revenueNet, p.cogs, p.shipping, p.paymentFee, p.profit], [100, 40, 20, 0, 40]);
  assert.equal(p.margin, 40);
  assert.equal(p.complete, true);
});

test("profit: card payment fee, returned order costs the shipping twice", () => {
  assert.equal(computeProfit({ orderTotal: 121, taxAmount: 21, codAmount: 0, shippingCost: 0, cogsAmount: 0 }, settings).paymentFee, 2.42);
  const r = computeProfit({ orderTotal: 121, taxAmount: 21, codAmount: 121, shippingCost: 24.2, cogsAmount: 40, awbStatus: "returned" }, settings);
  assert.deepEqual([r.revenueNet, r.cogs, r.shipping + r.returnCost, r.profit], [0, 0, 40, -40]);
  assert.equal(storeVatRate({ invoiceProvider: "fgo", fgoTVA: "0" }), 0);
});

test("financials from Shopify: cost × kept quantity, missing costs flagged", async () => {
  await prisma.order.deleteMany({ where: { shop: SHOP } });
  const o = await prisma.order.create({ data: { shop: SHOP, shopifyOrderId: "777001", shopifyOrderName: "#7001", customerName: "Ana", orderTotal: 121, codAmount: 121,
    awbNumber: "AWB1", courierType: "sameday", shippingCost: 24.2, awbStatus: "delivered", invoiceSeries: "PK", invoiceNumber: "0042",
    codCollectedAmount: 121, codCollectedAt: new Date("2026-09-20T10:00:00Z"), codPayoutRef: "BRD-9", shopifyCreatedAt: new Date("2026-09-15T10:00:00Z") } });
  const admin = { graphql: async () => new Response(JSON.stringify({ data: { nodes: [{ id: "gid://shopify/Order/777001",
    totalTaxSet: { shopMoney: { amount: "21" } }, totalRefundedSet: { shopMoney: { amount: "0" } },
    lineItems: { nodes: [{ quantity: 2, currentQuantity: 2, variant: { inventoryItem: { unitCost: { amount: "20" } } } }, { quantity: 1, currentQuantity: 1, variant: { inventoryItem: { unitCost: null } } }] } }] } })) };
  assert.equal((await syncOrderFinancials(admin, [o])).synced, 1);
  const saved = await prisma.order.findUnique({ where: { id: o.id } });
  assert.deepEqual([saved.cogsAmount, saved.cogsMissing, saved.taxAmount], [40, true, 21]);
});

test("exports: sales CSV for Excel, COD CSV, SAGA receipts and invoices", async () => {
  await prisma.shopSettings.upsert({ where: { shop: SHOP }, update: { smartbillCompanyCIF: "RO123456", senderName: "Magazin", sagaCodAccount: "5311" }, create: { shop: SHOP, smartbillCompanyCIF: "RO123456", senderName: "Magazin" } });
  const range = monthRange("2026-09");
  const sales = await salesCsv(SHOP, range);
  assert.ok(sales.startsWith("﻿"));
  assert.match(sales, /#7001;PK0042/);
  assert.match(sales, /;121,00;21,00;100,00;Ramburs;/);
  assert.match(await codCsv(SHOP, range), /AWB1;Sameday;#7001;PK0042;Ana;121,00;121,00;20\.09\.2026;BRD-9;0,00;delivered/);
  const rec = await sagaReceiptsXml(SHOP, range);
  assert.match(rec, /<Data>20\.09\.2026<\/Data>/);
  assert.match(rec, /<Numar>BRD-9<\/Numar>[\s\S]*<Suma>121\.00<\/Suma>[\s\S]*<Cont>5311<\/Cont>[\s\S]*<FacturaNumar>PK0042<\/FacturaNumar>/);
  const admin = { graphql: async () => new Response(JSON.stringify({ data: { nodes: [{ id: "gid://shopify/Order/777001",
    lineItems: { nodes: [{ name: "Ruj", sku: "R1", currentQuantity: 2, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "48.40" } } }] },
    shippingLines: { nodes: [{ title: "Sameday", discountedPriceSet: { shopMoney: { amount: "24.20" } } }] } }] } })) };
  const inv = await sagaInvoicesXml(admin, SHOP, range);
  assert.equal(inv.cif, "123456");
  assert.match(inv.xml, /<FurnizorCIF>123456<\/FurnizorCIF>/);
  assert.match(inv.xml, /<Descriere>Ruj<\/Descriere>[\s\S]*<Cantitate>2<\/Cantitate>[\s\S]*<Pret>40\.0000<\/Pret>[\s\S]*<Valoare>80\.00<\/Valoare>[\s\S]*<TVA>16\.80<\/TVA>/);
  assert.match(inv.xml, /<Descriere>Transport Sameday<\/Descriere>/);
});
