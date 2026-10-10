// Unit tests for the v2 features (pure functions + courier/invoicing payloads with a mocked API).
// Run: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";

import { parseRoStreet, normalizeRoPhone, isValidRoZip, normalizeRoCounty } from "../app/utils/address.js";
import { orthodoxEaster, romanianHolidays, isWorkingDay, addWorkingDays, estimateDelivery } from "../app/utils/delivery-estimate.js";
import { fgoHash, buildFgoInvoice } from "../app/services/fgo.server.js";
import { dpdStatusFromCode, officeToPickupPoint, pickDefaultService } from "../app/services/dpd.server.js";
import { freeShippingApplies, cartTotalOf } from "../app/services/checkout-rates.server.js";

// ── Address helpers ─────────────────────────────────────────────────────────
test("parseRoStreet splits a full Romanian address", () => {
  const r = parseRoStreet("Str. Lalelelor nr. 5, bl. A2, sc. 1, et. 3, ap. 12");
  assert.equal(r.streetType, "str.");
  assert.equal(r.streetName, "Lalelelor");
  assert.equal(r.streetNo, "5");
  assert.equal(r.blockNo, "A2");
  assert.equal(r.entranceNo, "1");
  assert.equal(r.floorNo, "3");
  assert.equal(r.apartmentNo, "12");
});

test("parseRoStreet handles boulevard, diacritics and a bare trailing number", () => {
  const r = parseRoStreet("Bulevardul Ștefan cel Mare 34");
  assert.equal(r.streetType, "bd.");
  assert.equal(r.streetName, "Stefan cel Mare");
  assert.equal(r.streetNo, "34");
});

test("normalizeRoPhone accepts local and international forms, rejects junk", () => {
  assert.equal(normalizeRoPhone("+40 722 123 456"), "0722123456");
  assert.equal(normalizeRoPhone("0040722123456"), "0722123456");
  assert.equal(normalizeRoPhone("0722-123-456"), "0722123456");
  assert.equal(normalizeRoPhone("722123456"), "0722123456");
  assert.equal(normalizeRoPhone("12345"), null);
  assert.equal(normalizeRoPhone(""), null);
});

test("isValidRoZip and normalizeRoCounty", () => {
  assert.equal(isValidRoZip("200585"), true);
  assert.equal(isValidRoZip("20058"), false);
  assert.equal(normalizeRoCounty("Bucharest"), "Bucuresti");
  assert.equal(normalizeRoCounty("Sector 3"), "Bucuresti");
  assert.equal(normalizeRoCounty("DOLJ"), "Dolj");
});

// ── Delivery estimate ───────────────────────────────────────────────────────
test("orthodox Easter dates are correct", () => {
  assert.equal(orthodoxEaster(2025).toISOString().slice(0, 10), "2025-04-20");
  assert.equal(orthodoxEaster(2026).toISOString().slice(0, 10), "2026-04-12");
  assert.equal(orthodoxEaster(2027).toISOString().slice(0, 10), "2027-05-02");
});

test("Romanian holidays include fixed and movable days", () => {
  const h = romanianHolidays(2026);
  for (const d of ["2026-01-01", "2026-01-24", "2026-12-01", "2026-04-10", "2026-04-13", "2026-05-31", "2026-06-01"]) assert.ok(h.has(d), d);
  assert.equal(isWorkingDay(new Date("2026-12-01T00:00:00Z")), false);
  assert.equal(isWorkingDay(new Date("2026-10-12T00:00:00Z")), true);   // Monday
  assert.equal(isWorkingDay(new Date("2026-10-10T00:00:00Z")), false);  // Saturday
});

test("addWorkingDays skips weekends and holidays", () => {
  // Fri 27 Nov 2026 + 1 → Mon 30 Nov is a holiday (Sf. Andrei), Tue 1 Dec too → Wed 2 Dec
  assert.equal(addWorkingDays(new Date("2026-11-27T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-12-02");
});

test("estimateDelivery respects the dispatch cut-off (Romania time)", () => {
  // Mon 12 Oct 2026, 10:00 Bucharest (07:00 UTC) → ships today, arrives Tue–Wed
  const before = estimateDelivery({ now: new Date("2026-10-12T07:00:00Z"), cutoffHour: 14 });
  assert.equal(before.shipDate.toISOString().slice(0, 10), "2026-10-12");
  assert.equal(before.minDate.toISOString().slice(0, 10), "2026-10-13");
  assert.equal(before.maxDate.toISOString().slice(0, 10), "2026-10-14");
  // 15:00 Bucharest → ships Tuesday
  const after = estimateDelivery({ now: new Date("2026-10-12T12:00:00Z"), cutoffHour: 14 });
  assert.equal(after.shipDate.toISOString().slice(0, 10), "2026-10-13");
  // Saturday → ships Monday
  const weekend = estimateDelivery({ now: new Date("2026-10-10T08:00:00Z"), cutoffHour: 14 });
  assert.equal(weekend.shipDate.toISOString().slice(0, 10), "2026-10-12");
});

// ── FGO ─────────────────────────────────────────────────────────────────────
test("FGO hash matches the example in FGO's documentation", () => {
  assert.equal(fgoHash("2864518", "1234567890", "Ionescu Popescu"), "8C3A7726804C121C6933F7D68494B439463996E2");
});

const ORDER = {
  shopifyOrderName: "#1001", customerName: "Ionescu Popescu", customerEmail: "ion@example.com", customerPhone: "0722123456",
  shippingAddress1: "Str. Lalelelor nr. 5", shippingCity: "Craiova", shippingCounty: "Dolj", shippingCountry: "Romania",
  shippingTotal: 15, lineItems: [{ name: "Tricou", sku: "TR-1", quantity: 2, unitPrice: 49.5 }], idempotencyKey: "picklo-shop-123",
};

test("buildFgoInvoice: individual customer, VAT-inclusive totals, shipping line", () => {
  const p = buildFgoInvoice({ cui: "2864518", privateKey: "1234567890", series: "FCT", tva: "21", currency: "RON", order: ORDER });
  assert.equal(p.Hash, "8C3A7726804C121C6933F7D68494B439463996E2");
  assert.equal(p.Client.Tip, "PF");
  assert.equal(p.Client.Tara, "RO");
  assert.equal(p.Client.Judet, "Dolj");
  assert.equal(p.Continut.length, 2);
  assert.deepEqual(p.Continut[0], { Denumire: "Tricou", CodArticol: "TR-1", NrProduse: 2, UM: "BUC", CotaTVA: 21, PretTotal: 99 });
  assert.equal(p.Continut[1].Denumire, "Transport");
  assert.equal(p.Continut[1].PretTotal, 15);
  assert.equal(p.VerificareDuplicat, true);
});

test("buildFgoInvoice: company customer becomes PJ with CUI and the company name in the hash", () => {
  const p = buildFgoInvoice({ cui: "2864518", privateKey: "k", series: "FCT", tva: "21", currency: "RON",
    order: { ...ORDER, customerCompany: "Acme SRL", customerVatCode: "RO123456", customerRegCom: "J16/1/2020" } });
  assert.equal(p.Client.Tip, "PJ");
  assert.equal(p.Client.Denumire, "Acme SRL");
  assert.equal(p.Client.CodUnic, "RO123456");
  assert.equal(p.Client.NrRegCom, "J16/1/2020");
  assert.equal(p.Hash, fgoHash("2864518", "k", "Acme SRL"));
});

// ── DPD ─────────────────────────────────────────────────────────────────────
test("DPD operation codes map to Picklo statuses", () => {
  assert.equal(dpdStatusFromCode(-14), "delivered");
  assert.equal(dpdStatusFromCode("12"), "out_for_delivery");
  assert.equal(dpdStatusFromCode(134), "out_for_delivery");
  assert.equal(dpdStatusFromCode(123), "returned");
  assert.equal(dpdStatusFromCode(44), "failed");
  assert.equal(dpdStatusFromCode(9999), null);
});

test("DPD office and locker become pickup points", () => {
  const apt = officeToPickupPoint({ id: 777, name: "Craiova Lidl", type: "APT",
    address: { fullAddressString: "Craiova, Str. Caracal 10", siteName: "CRAIOVA", postCode: "200585", x: 23.8, y: 44.3, siteAddressString: "gr. CRAIOVA, jud. DOLJ" } });
  assert.equal(apt.externalId, "777");
  assert.equal(apt.courier, "dpd");
  assert.equal(apt.type, "dpdbox");
  assert.equal(apt.name, "DPDbox Craiova Lidl");
  assert.equal(apt.lat, 44.3);
  assert.equal(apt.lng, 23.8);
  assert.equal(apt.county, "DOLJ");
});

test("pickDefaultService prefers a domestic standard service", () => {
  const s = pickDefaultService([
    { id: 2412, name: "DPD International", nameEn: "DPD International" },
    { id: 2505, name: "DPD STANDARD", nameEn: "DPD STANDARD" },
  ]);
  assert.equal(s.id, 2505);
});

// ── Free shipping ───────────────────────────────────────────────────────────
test("free shipping threshold and scope", () => {
  const s = { freeShippingThreshold: 200, freeShippingScope: "all" };
  assert.equal(freeShippingApplies(s, 199.99, "home"), false);
  assert.equal(freeShippingApplies(s, 200, "home"), true);
  assert.equal(freeShippingApplies({ ...s, freeShippingScope: "pickup" }, 250, "home"), false);
  assert.equal(freeShippingApplies({ ...s, freeShippingScope: "pickup" }, 250, "pickup"), true);
  assert.equal(freeShippingApplies({ freeShippingThreshold: null }, 999, "home"), false);
  assert.equal(cartTotalOf({ items: [{ price: 4950, quantity: 2 }, { price: 1000, quantity: 1 }] }), 109);
});
