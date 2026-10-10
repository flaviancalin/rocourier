// COD statements, refusal protection, reports and storefront page escaping.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";

import { readCodStatement, parseCsv } from "../app/services/cod.server.js";
import { contactHash as serverHash, buildBlocklist } from "../app/services/cod-guard.server.js";
import { contactHash as functionHash } from "../extensions/picklo-cod-guard/src/hash.js";
import { summarize } from "../app/services/analytics.server.js";
import { esc } from "../app/services/storefront-pages.server.js";

test("COD statement: FAN-style CSV with title row, semicolons and Romanian numbers", () => {
  const csv = "Borderou ramburs\nNr. AWB;Destinatar;Valoare ramburs;Data plata\n2345678901;Ion;1.234,50;09.10.2026\n2345678902;Ana;99,90;10.10.2026\n;Total;1334,40;\n";
  const rows = readCodStatement(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { awbNumber: "2345678901", amount: 1234.5, paidAt: new Date(Date.UTC(2026, 9, 9)) });
  assert.equal(rows[1].amount, 99.9);
});

test("COD statement: comma CSV with quotes and ISO dates, ignores cost columns", () => {
  const csv = 'AWB,Cost transport,Suma incasata,Data\n"1EB123456789","18.50","250.00",2026-10-08\n';
  const rows = readCodStatement(csv);
  assert.deepEqual(rows, [{ awbNumber: "1EB123456789", amount: 250, paidAt: new Date(Date.UTC(2026, 9, 8)) }]);
});

test("COD statement without an AWB column is rejected with a clear message", () => {
  assert.throws(() => readCodStatement("Nume;Suma\nIon;10\n"), /coloana cu AWB/);
  assert.deepEqual(parseCsv('a;"b;c"\n1;2'), [["a", "b;c"], ["1", "2"]]);
});

test("refusal blocklist hash is identical on the server and in the checkout function", () => {
  for (const v of ["ion@example.com", "744555666", "ăîșț@x.ro"]) assert.equal(serverHash(v), functionHash(v));
  assert.match(serverHash("x"), /^[0-9a-f]{16}$/);
});

test("refusal blocklist counts refusals per contact and respects the threshold", async () => {
  const { prisma } = await import("../app/db.server.js");
  const shop = `blocklist-test-${Date.now()}.myshopify.com`;
  const base = { shop, shopifyOrderName: "#1", awbStatus: "returned", courierType: "fan" };
  await prisma.order.createMany({ data: [
    { ...base, shopifyOrderId: "1", customerEmail: "Ion@Example.com", customerPhone: "+40 744 555 666" },
    { ...base, shopifyOrderId: "2", customerEmail: "ion@example.com", customerPhone: "0744555666" },
    { ...base, shopifyOrderId: "3", customerEmail: "ana@example.com", customerPhone: "0722000000" },
    { ...base, shopifyOrderId: "4", customerEmail: "ana@example.com", customerPhone: "0722000000", awbStatus: "delivered" },
  ] });
  try {
    const two = await buildBlocklist(shop, 2);
    assert.deepEqual(two, [serverHash("744555666"), serverHash("ion@example.com")].sort());
    assert.equal((await buildBlocklist(shop, 1)).length, 4);
    assert.deepEqual(await buildBlocklist(shop, 0), []);
  } finally {
    await prisma.order.deleteMany({ where: { shop } });
  }
});

test("delivery report per courier", () => {
  const d = (days) => new Date(Date.UTC(2026, 9, 1 + days));
  const r = summarize([
    { courierType: "fan", awbStatus: "delivered", createdAt: d(0), deliveredAt: d(2), shippingCost: 15, orderTotal: 150, shippingMethod: "pickup_point", pickupPointName: "FANbox A", codAmount: 150 },
    { courierType: "fan", awbStatus: "returned", createdAt: d(0), deliveredAt: null, shippingCost: 15, orderTotal: 150, shippingMethod: "home_delivery", codAmount: 150 },
    { courierType: "dpd", awbStatus: "in_transit", createdAt: d(0), orderTotal: 80, shippingMethod: "home_delivery", codAmount: 0 },
  ]);
  const fan = r.couriers.find((c) => c.courier === "fan");
  assert.equal(r.total, 3);
  assert.equal(fan.deliveryRate, 50);
  assert.equal(fan.returnRate, 50);
  assert.equal(fan.avgDays, 2);
  assert.equal(fan.avgCost, 15);
  assert.equal(fan.costShare, 10);
  assert.equal(r.pickupShare, 33.3);
  assert.deepEqual(r.topLockers, [{ name: "FANbox A", count: 1 }]);
  assert.equal(r.couriers.find((c) => c.courier === "dpd").deliveryRate, null);
});

test("storefront pages escape HTML and Liquid", () => {
  assert.equal(esc(`<script>{{ x }}</script>"'&`), "&lt;script&gt;&#123;&#123; x &#125;&#125;&lt;/script&gt;&quot;&#39;&amp;");
});
