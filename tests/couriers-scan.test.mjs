// Fixes found by the live courier scan (2026-10-10). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { samedayServiceFor, samedayTrackAwb, samedayCalculatePrice } from "../app/services/sameday.server.js";

const SERVICES = [
  { id: 7, name: "24H", code: "24", defaultServices: true }, { id: 10, name: "Retur Standard", code: "RS" },
  { id: 15, name: "Locker NextDay", code: "LN" }, { id: 17, name: "Locker Home Delivery", code: "LH" }, { id: 57, name: "Pudo Nextday", code: "PP" },
];

test("sameday: home → 24H, easybox → LN, PUDO → PP, legacy 'T' → 24H", () => {
  assert.equal(samedayServiceFor(SERVICES).id, 7);
  assert.equal(samedayServiceFor(SERVICES, { pointType: "easybox" }).id, 15);
  assert.equal(samedayServiceFor(SERVICES, { pointType: "pudo" }).id, 57);
  assert.equal(samedayServiceFor(SERVICES, { override: "T" }).id, 7);
  assert.equal(samedayServiceFor(SERVICES, { override: "15" }).id, 15);
  assert.equal(samedayServiceFor([], {}), null);
});

function mockFetch(handler) {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const [status, body] = handler(String(url), init);
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const auth = (url) => url.endsWith("/api/authenticate") ? [200, { token: "t", expire_at_utc: 4102444800 }] : null;

test("sameday: tracking reads expeditionHistory from /api/client/awb/{awb}/status", async () => {
  const m = mockFetch((url) => auth(url) || [200, { expeditionSummary: {}, expeditionHistory: [
    { statusId: 9, status: "Livrat", statusLabel: "Colet livrat", statusState: "Livrat", statusDate: "2026-10-10T12:00:00+03:00", county: "Dolj", reason: "", transitLocation: "Craiova" },
  ], parcelsStatus: [] }]);
  try {
    const ev = await samedayTrackAwb({ username: "scan-u1", password: "p", awbNumber: "1ONB123" });
    assert.ok(m.calls.some((c) => c.url.endsWith("/api/client/awb/1ONB123/status")));
    assert.equal(ev.length, 1);
    assert.match(ev[0].description, /Colet livrat/);
    assert.equal(ev[0].location, "Craiova");
  } finally { m.restore(); }
});

test("sameday: price estimate posts a form to /api/awb/estimate-cost", async () => {
  const m = mockFetch((url) => auth(url) || [200, { amount: 17.58, currency: "Ron", time: 72 }]);
  try {
    const r = await samedayCalculatePrice({ username: "scan-u2", password: "p", pickupPointId: 1, serviceId: 7, destCountyId: 10, destCityId: 20, weight: 1, codAmount: 100 });
    assert.equal(r.amount, 17.58);
    const call = m.calls.find((c) => c.url.endsWith("/api/awb/estimate-cost"));
    const form = new URLSearchParams(call.init.body);
    assert.equal(form.get("service"), "7");
    assert.equal(form.get("awbRecipient[county]"), "10");
    assert.equal(form.get("parcels[0][weight]"), "1");
    assert.equal(form.get("cashOnDelivery"), "100");
  } finally { m.restore(); }
});

test("fan: tariff with COD sends returnPayment; FANbox COD without card payment gets a clear hint", async () => {
  const { fanCalculatePrice, fanCreateAwb } = await import("../app/services/fan-courier.server.js");
  const m = mockFetch((url) => url.includes("/login") ? [200, { data: { token: "t", expiresAt: "2099-01-01 00:00:00" } }]
    : url.includes("internal-tariff") ? [200, { data: { total: 46.31 } }]
    : [200, { response: [{ awbNumber: null, success: false, errors: { "info.options": ["The cash on delivery field can only be filled if the client accepts card payment"] } }] }]);
  try {
    await fanCalculatePrice({ clientId: "1", username: "scan-f1", password: "p", params: { service: "Cont Colector", codAmount: 100 } });
    const t = m.calls.find((c) => c.url.includes("internal-tariff"));
    assert.equal(new URL(t.url).searchParams.get("info[returnPayment]"), "expeditor");
    await assert.rejects(fanCreateAwb({ clientId: "1", username: "scan-f1", password: "p", pickupPointId: "F1000005",
      order: { customerName: "Ana Pop", customerPhone: "0744555666", customerEmail: "a@b.ro", shippingCity: "Bucuresti", shippingCounty: "Bucuresti", codAmount: 100 },
      settings: { senderName: "S", senderCity: "Craiova", senderAddress: "Str. X 1", senderPhone: "0744555666", senderCounty: "Dolj" } }), /nu are activată încasarea cu cardul/);
  } finally { m.restore(); }
});

test("tracking: a cancelled Sameday shipment maps to cancelled", async () => {
  const { statusFromEvents } = await import("../app/services/tracking.server.js");
  assert.equal(statusFromEvents([
    { description: "Expedierea a fost înregistrată. · AWB issued", date: "2026-10-10T17:13:56Z" },
    { description: "Expedierea a fost anulată. · Order canceled · The sender has cancelled the delivery", date: "2026-10-10T17:13:58Z" },
  ], "sameday"), "cancelled");
});

test("gls: parcel id and label are stored together; legacy refs still parse", async () => {
  const { glsStoreRef, glsParseRef } = await import("../app/services/gls.server.js");
  assert.deepEqual(glsParseRef(glsStoreRef(15836961, "JVBERi0=")), { parcelId: 15836961, label: "JVBERi0=" });
  assert.deepEqual(glsParseRef(glsStoreRef(15836961, null)), { parcelId: 15836961, label: null });
  assert.deepEqual(glsParseRef("gls_label:JVBERi0="), { parcelId: null, label: "JVBERi0=" });
  assert.deepEqual(glsParseRef("gls_parcelid:42"), { parcelId: 42, label: null });
  assert.deepEqual(glsParseRef(null), { parcelId: null, label: null });
});

test("gls: reprint looks the parcel up by number and explains the print-once rule", async () => {
  const { glsDownloadAwbPdf } = await import("../app/services/gls.server.js");
  const m = mockFetch((url) => url.endsWith("/GetParcelList") ? [200, { PrintDataInfoList: [{ ParcelId: 777, ParcelNumber: 6007503281 }] }]
    : [200, { Labels: null, GetPrintedLabelsErrorList: [{ ErrorCode: 18, ErrorDescription: "Parcel label is already generated" }] }]);
  try {
    await assert.rejects(glsDownloadAwbPdf({ username: "u", password: "p", awbNumber: "6007503281" }), /o singură dată/);
    const body = JSON.parse(m.calls.find((c) => c.url.endsWith("/GetPrintedLabels")).init.body);
    assert.deepEqual(body.ParcelIdList, [777]);
  } finally { m.restore(); }
});

test("gls: the label byte array from PrintLabels is stored as real PDF base64", async () => {
  const { glsCreateAwb } = await import("../app/services/gls.server.js");
  const pdf = [...Buffer.from("%PDF-1.4 test")];
  const m = mockFetch(() => [200, { Labels: pdf, PrintLabelsErrorList: [], PrintLabelsInfoList: [{ ParcelId: 9, ParcelNumber: 6007500001 }] }]);
  try {
    const r = await glsCreateAwb({ username: "u", password: "p", clientNumber: 1, settings: { senderName: "S", senderCity: "Constanta", senderAddress: "Poporului 76" },
      order: { shopifyOrderName: "#1", customerName: "A B", customerPhone: "0744555666", shippingAddress1: "Str X 1", shippingCity: "Craiova", shippingZip: "200585", weight: 1 } });
    assert.equal(Buffer.from(r.labelBase64, "base64").toString().slice(0, 4), "%PDF");
    assert.equal(r.parcelId, 9);
  } finally { m.restore(); }
});
