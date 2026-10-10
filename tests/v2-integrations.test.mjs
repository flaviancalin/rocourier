// Courier / invoicing request shapes against the official docs, with fetch mocked,
// plus order checks, routing rules, tracking status and COD amount.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";

import { dpdCreateAwb, dpdTrackAwb, dpdGetPickupPoints, dpdGetCodPayouts, dpdDeleteAwb, dpdPrintAwb } from "../app/services/dpd.server.js";
import { fgoCreateInvoice, fgoReverseInvoice, fgoTestConnection, fgoHash } from "../app/services/fgo.server.js";
import { checkOrderData, ruleMatches, courierFromRules } from "../app/services/order-checks.server.js";
import { statusFromEvents } from "../app/services/tracking.server.js";
import { codAmountFor } from "../app/models/order.server.js";
import { desiredManualRates } from "../app/services/checkout-setup.server.js";

// ── fetch mock ──────────────────────────────────────────────────────────────
function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const out = await handler(String(url), body);
    const isBuffer = out instanceof Uint8Array;
    return new Response(isBuffer ? out : JSON.stringify(out), {
      status: 200, headers: { "content-type": isBuffer ? "application/pdf" : "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const SETTINGS = { senderName: "Magazin Test", senderPhone: "0722000111", senderEmail: "shop@example.com", dpdServiceId: "2505" };
const ORDER = {
  shopifyOrderName: "#1001", customerName: "Ion Popescu", customerPhone: "+40 744 555 666", customerEmail: "ion@example.com",
  shippingAddress1: "Str. Lalelelor nr. 5, bl. A2, ap. 12", shippingCity: "Craiova", shippingCounty: "Dolj", shippingZip: "200585",
  codAmount: 149.9, weight: 1.2, packageCount: 1,
};

// ── DPD ─────────────────────────────────────────────────────────────────────
test("DPD: home delivery AWB resolves the site and sends a structured address with COD", async () => {
  const m = mockFetch((url, body) => {
    if (url.endsWith("/location/site")) return { sites: [{ id: 10135, name: "CRAIOVA", region: "DOLJ", postCode: "200585" }] };
    if (url.endsWith("/shipment")) return { id: "80012345678", parcels: [{ id: "80012345678", seqNo: 1 }], price: { total: 18.5 } };
    throw new Error("unexpected " + url);
  });
  try {
    const r = await dpdCreateAwb({ username: "u", password: "p", order: ORDER, settings: SETTINGS });
    assert.equal(r.success, true);
    assert.equal(r.awbNumber, "80012345678");
    assert.equal(r.price, 18.5);
    const ship = m.calls.find((c) => c.url.endsWith("/shipment")).body;
    assert.equal(ship.userName, "u");
    assert.equal(ship.service.serviceId, 2505);
    assert.deepEqual(ship.service.additionalServices.cod, { amount: 149.9, processingType: "CASH" });
    assert.equal(ship.recipient.phone1.number, "0744555666");
    assert.equal(ship.recipient.privatePerson, true);
    assert.equal(ship.recipient.address.siteId, 10135);
    assert.equal(ship.recipient.address.streetName, "Lalelelor");
    assert.equal(ship.recipient.address.streetNo, "5");
    assert.equal(ship.recipient.address.blockNo, "A2");
    assert.equal(ship.recipient.address.apartmentNo, "12");
    assert.equal(ship.content.parcelsCount, 1);
    assert.equal(ship.content.totalWeight, 1.2);
    assert.equal(ship.payment.courierServicePayer, "RECIPIENT");
    assert.equal(ship.ref1, "#1001");
  } finally { m.restore(); }
});

test("DPD: locker delivery uses pickupOfficeId and sends no address", async () => {
  const m = mockFetch((url) => (url.endsWith("/shipment") ? { id: "800999", parcels: [{ id: "800999" }] } : {}));
  try {
    await dpdCreateAwb({ username: "u", password: "p", order: ORDER, settings: SETTINGS, pickupOfficeId: "777" });
    const ship = m.calls.find((c) => c.url.endsWith("/shipment")).body;
    assert.equal(ship.recipient.pickupOfficeId, 777);
    assert.equal(ship.recipient.address, undefined);
    assert.equal(m.calls.some((c) => c.url.endsWith("/location/site")), false);
  } finally { m.restore(); }
});

test("DPD: API errors surface with code and message", async () => {
  const m = mockFetch(() => ({ error: { code: 120, message: "Invalid address" } }));
  try {
    await assert.rejects(dpdCreateAwb({ username: "u", password: "p", order: ORDER, settings: SETTINGS, pickupOfficeId: "1" }), /DPD \[120\]: Invalid address/);
  } finally { m.restore(); }
});

test("DPD: invalid phone is refused before calling the API", async () => {
  const m = mockFetch(() => ({}));
  try {
    await assert.rejects(dpdCreateAwb({ username: "u", password: "p", order: { ...ORDER, customerPhone: "123" }, settings: SETTINGS }), /telefonul/);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test("DPD: tracking, offices, payouts, cancel and print", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 test");
  const m = mockFetch((url) => {
    if (url.endsWith("/track")) return { parcels: [{ parcelId: "800", operations: [
      { operationCode: 148, description: "Shipment data received", dateTime: "2026-10-10T08:00:00+0300" },
      { operationCode: -14, description: "Delivered", dateTime: "2026-10-12T12:00:00+0300", place: "CRAIOVA" },
    ] }] };
    if (url.endsWith("/location/office")) return { offices: [
      { id: 1, name: "Craiova Office", type: "OFFICE", pickUpAllowed: true, address: { fullAddressString: "x", x: 23.8, y: 44.3 } },
      { id: 2, name: "Pallet hub", type: "OFFICE", pickUpAllowed: true, cargoTypesAllowed: ["PALLET"], address: {} },
      { id: 3, name: "Drop-off only", type: "APT", pickUpAllowed: false, address: {} },
    ] };
    if (url.endsWith("/payments")) return { payouts: [{ date: "2026-10-09", docId: 55, currency: "RON", details: [{ shipmentId: "800", amount: 149.9, ref1: "#1001" }] }] };
    if (url.endsWith("/shipment/cancel")) return {};
    if (url.endsWith("/print")) return pdf;
    return {};
  });
  try {
    const events = await dpdTrackAwb({ username: "u", password: "p", awbNumber: "800" });
    assert.equal(statusFromEvents(events, "dpd"), "delivered");
    assert.equal(events[1].location, "CRAIOVA");

    const points = await dpdGetPickupPoints({ username: "u", password: "p" });
    assert.deepEqual(points.map((p) => p.externalId), ["1"]);

    const payouts = await dpdGetCodPayouts({ username: "u", password: "p", from: new Date("2026-10-01"), to: new Date("2026-10-10") });
    assert.deepEqual(payouts[0], { awbNumber: "800", amount: 149.9, currency: "RON", paidAt: new Date("2026-10-09"), reference: "#1001", documentId: "55" });
    const payReq = m.calls.find((c) => c.url.endsWith("/payments")).body;
    assert.match(payReq.fromDate, /^2026-10-01T00:00:00\+0000$/);
    assert.equal(payReq.includeDetails, true);

    await dpdDeleteAwb({ username: "u", password: "p", awbNumber: "800" });
    assert.equal(m.calls.find((c) => c.url.endsWith("/shipment/cancel")).body.shipmentId, "800");

    const buf = await dpdPrintAwb({ username: "u", password: "p", awbNumber: "800", paperSize: "A6" });
    assert.equal(Buffer.from(buf).toString().startsWith("%PDF"), true);
    assert.deepEqual(m.calls.find((c) => c.url.endsWith("/print")).body.parcels, [{ parcel: { id: "800" } }]);
  } finally { m.restore(); }
});

// ── FGO ─────────────────────────────────────────────────────────────────────
test("FGO: issue invoice posts signed JSON to the test environment", async () => {
  const m = mockFetch(() => ({ Success: true, Factura: { Numar: "001", Serie: "FCT", Link: "https://fgo.ro/f.pdf" } }));
  try {
    const doc = await fgoCreateInvoice({ cui: "2864518", privateKey: "1234567890", sandbox: true, series: "FCT", tva: "21", currency: "RON",
      order: { ...ORDER, customerName: "Ionescu Popescu", shippingCountry: "Romania", shippingTotal: 0, lineItems: [{ name: "Tricou", quantity: 1, unitPrice: 100 }] } });
    assert.deepEqual(doc, { series: "FCT", number: "001", url: "https://fgo.ro/f.pdf" });
    assert.equal(m.calls[0].url, "https://api-testuat.fgo.ro/v1/factura/emitere");
    assert.equal(m.calls[0].body.Hash, "8C3A7726804C121C6933F7D68494B439463996E2");
    assert.ok(m.calls[0].body.PlatformaUrl);
  } finally { m.restore(); }
});

test("FGO: storno signs with the invoice number and errors drop the .NET stack trace", async () => {
  const m = mockFetch((url) => (url.endsWith("/stornare")
    ? { Success: true, Factura: { Numar: "002", Serie: "FCT" } }
    : { Success: false, Message: "System.Exception: Codul unic nu exista sau nu este asociat.\r\n   at Fgo.PublicApi..." }));
  try {
    const st = await fgoReverseInvoice({ cui: "2864518", privateKey: "k", series: "FCT", number: "001" });
    assert.equal(st.number, "002");
    assert.equal(m.calls[0].body.Hash, fgoHash("2864518", "k", "001"));
    await assert.rejects(fgoTestConnection({ cui: "1", privateKey: "bad" }), /^Error: FGO: Codul unic nu exista sau nu este asociat\.$/);
  } finally { m.restore(); }
});

test("FGO: test connection passes when only the probe invoice is missing", async () => {
  const m = mockFetch(() => ({ Success: false, Message: "Factura nu a fost gasita" }));
  try {
    assert.deepEqual(await fgoTestConnection({ cui: "2864518", privateKey: "k" }), { success: true });
  } finally { m.restore(); }
});

// ── Order checks & routing ──────────────────────────────────────────────────
test("checkOrderData flags the usual courier rejections", () => {
  const codes = (o) => checkOrderData(o).map((i) => i.code);
  assert.deepEqual(codes({ ...ORDER, shippingMethod: "home_delivery" }), []);
  assert.ok(codes({ ...ORDER, customerPhone: "12" }).includes("phone_invalid"));
  assert.ok(codes({ ...ORDER, shippingZip: "2005" }).includes("zip_invalid"));
  assert.ok(codes({ ...ORDER, shippingZip: "030167" }).includes("zip_county"));
  assert.ok(codes({ ...ORDER, shippingAddress1: "Strada Florilor" }).includes("address_no_number"));
  assert.ok(codes({ ...ORDER, shippingMethod: "pickup_point", pickupPointId: null }).includes("locker_missing"));
  assert.deepEqual(codes({ ...ORDER, shippingMethod: "pickup_point", pickupPointId: "77", shippingZip: "" }), []);
});

test("routing rules: first enabled match wins, lockers keep their network", () => {
  const settings = { fanEnabled: true, samedayEnabled: true, dpdEnabled: false, routingRules: [
    { field: "county", value: "Bucuresti, Ilfov", courier: "sameday" },
    { field: "weight_over", value: "10", courier: "dpd" },          // disabled courier → skipped
    { field: "cod", courier: "fan" },
  ] };
  assert.equal(courierFromRules(settings, { ...ORDER, shippingCounty: "București" }), "sameday");
  assert.equal(courierFromRules(settings, { ...ORDER, weight: 20 }), "fan");
  assert.equal(courierFromRules(settings, { ...ORDER, codAmount: 0, weight: 1 }), null);
  assert.equal(courierFromRules(settings, { ...ORDER, shippingCounty: "Ilfov", shippingMethod: "pickup_point", pickupPointId: "9", courierType: "fan" }), "fan");
  assert.equal(ruleMatches({ field: "total_over", value: "300" }, { orderTotal: 350 }), true);
});

// ── Tracking text rules ─────────────────────────────────────────────────────
test("tracking text maps returns and failures before deliveries", () => {
  const ev = (description, date) => ({ description, date });
  assert.equal(statusFromEvents([ev("Expeditie preluata", "2026-10-01"), ev("Livrat", "2026-10-02")], "fan"), "delivered");
  assert.equal(statusFromEvents([ev("Livrat inapoi la expeditor", "2026-10-05")], "fan"), "returned");
  assert.equal(statusFromEvents([ev("Nelivrat - destinatar absent", "2026-10-03")], "cargus"), "failed");
  assert.equal(statusFromEvents([ev("Coletul a fost depus in easybox", "2026-10-03")], "sameday"), "out_for_delivery");
  assert.equal(statusFromEvents([ev("In tranzit spre hub", "2026-10-02")], "gls"), "in_transit");
  assert.equal(statusFromEvents([ev("Refuzat de destinatar", "2026-10-04")], "fan"), "returned");
});

// ── COD amount ──────────────────────────────────────────────────────────────
test("COD is zero for orders paid online and the outstanding amount otherwise", () => {
  assert.equal(codAmountFor({ financial_status: "paid", total_price: "199.00" }), 0);
  assert.equal(codAmountFor({ financial_status: "pending", total_price: "199.00", total_outstanding: "199.00" }), 199);
  assert.equal(codAmountFor({ financial_status: "partially_paid", total_price: "199.00", total_outstanding: "99.00" }), 99);
  assert.equal(codAmountFor({ financial_status: "pending", total_price: "50" }), 50);
});

// ── Manual checkout rates with free shipping ────────────────────────────────
test("manual rates: paid below the threshold, free from it", () => {
  assert.deepEqual(desiredManualRates({ freeShippingThreshold: 0 }, 15, "home"), [{ price: 15, min: null, max: null }]);
  assert.deepEqual(desiredManualRates({ freeShippingThreshold: 200, freeShippingScope: "all" }, 15, "home"),
    [{ price: 15, min: null, max: 199.99 }, { price: 0, min: 200, max: null }]);
  assert.deepEqual(desiredManualRates({ freeShippingThreshold: 200, freeShippingScope: "pickup" }, 15, "home"), [{ price: 15, min: null, max: null }]);
  assert.deepEqual(desiredManualRates({ freeShippingThreshold: 200 }, 0, "pickup"), [{ price: 0, min: null, max: null }]);
});

// ── FGO v2 (Bearer keys) ────────────────────────────────────────────────────
import { buildFgoInvoiceV2, problemMessage, isV2Key } from "../app/services/fgo.server.js";

test("FGO v2: key format picks the REST v2 API", () => {
  assert.equal(isV2Key("fgo_test_api_v1.20260820.abc.def.ghi"), true);
  assert.equal(isV2Key("fgo_api_v1.x"), true);
  assert.equal(isV2Key("1234567890"), false);
});

test("FGO v2: invoice body uses snake_case, VAT coefficient and county code", () => {
  const b = buildFgoInvoiceV2({ series: "CAL", tva: "21", currency: "RON", countyCode: "DJ",
    order: { shopifyOrderName: "#1", customerName: "Ion", shippingCountry: "Romania", shippingCity: "Craiova", shippingAddress1: "Str. X 1",
      shippingTotal: 15, idempotencyKey: "picklo-shop-1", lineItems: [{ name: "Tricou", sku: "T1", quantity: 2, unitPrice: 49.5 }] } });
  assert.equal(b.tip_factura, "F");
  assert.equal(b.verificare_duplicat, true);
  assert.deepEqual(b.client, { tip: "PF", denumire: "Ion", tara: "ROMANIA", cod_judet: "DJ", localitate: "Craiova", adresa: "Str. X 1" });
  assert.deepEqual(b.articole[0], { tip: "Articol", denumire: "Tricou", cod_articol: "T1", um: "BUC", nr_produse: 2, cota_tva: 0.21, pret_total: 99, nr_crt: 1 });
  assert.equal(b.articole[1].denumire, "Transport");
});

test("FGO v2: issue sends Bearer + company + platform headers and reuses duplicates", async () => {
  let n = 0;
  const m = mockFetch((url) => {
    if (url.includes("/nomenclatoare/judete")) return { data: [{ nume: "Dolj", cod: "DJ" }] };
    if (url.endsWith("/v2/facturi")) { n++; return { data: { serie: "CAL", numar: "0007" } }; }
    if (url.endsWith("/genereaza-link-de-descarcare")) return { data: { link: "https://fgo/x.pdf" } };
    return {};
  });
  try {
    const doc = await (await import("../app/services/fgo.server.js")).fgoCreateInvoice({
      cui: "RO5040613160049", privateKey: "fgo_test_api_v1.k", sandbox: true, platformUrl: "https://s.myshopify.com", series: "CAL", tva: "21",
      order: { customerName: "Ion", shippingCounty: "Dolj", shippingCountry: "RO", shippingTotal: 0, lineItems: [{ name: "A", quantity: 1, unitPrice: 10 }] } });
    assert.deepEqual(doc, { series: "CAL", number: "0007", url: "https://fgo/x.pdf" });
    const call = m.calls.find((c) => c.url.endsWith("/v2/facturi"));
    assert.equal(call.url, "https://api-testuat.fgo.ro/v2/facturi");
    assert.equal(call.body.client.cod_judet, "DJ");
  } finally { m.restore(); }
});

test("FGO v2: problem+json errors become one readable message", () => {
  assert.equal(problemMessage({ title: "Cererea nu a trecut validarea.", validation_errors: [{ pointer: "/articole", issues: [{ message: "minim un articol" }] }] }, 400),
    "FGO: Cererea nu a trecut validarea. · /articole: minim un articol");
  assert.equal(problemMessage({ detail: "x", motiv: { cod: "cod_unic_neasociat", mesaj: "Codul unic nu e al cheii." } }, 403), "FGO: Codul unic nu e al cheii.");
});
