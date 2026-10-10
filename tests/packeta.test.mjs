// Packeta: credentials, packet attributes, REST/XML flows with a mocked API. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  packetaCredentials, buildPacketAttributes, packetaStatus, packetaCreatePacket, packetaDownloadLabel,
  packetaTrackPacket, packetaCreateReturn, pointToRow,
} from "../app/services/packeta.server.js";

const ORDER = {
  shopifyOrderName: "#1050", customerName: "Ana Maria Popescu", customerEmail: "ana@example.com", customerPhone: "0744 555 666",
  shippingAddress1: "Str. Lalelelor nr. 5, bl. A2, ap. 12", shippingCity: "Craiova", shippingCounty: "Dolj", shippingZip: "200585",
  shippingCountry: "RO", codAmount: 149.9, orderTotal: 149.9, weight: 1.2,
};

function mockRest(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body || "" });
    const out = handler(String(url), String(init.body || ""));
    return new Response(typeof out === "string" ? out : JSON.stringify(out), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const ok = (inner) => `<?xml version="1.0"?><response><status>ok</status><result>${inner}</result></response>`;

test("credentials: the 16-char key and the 32-char password are told apart", () => {
  assert.deepEqual(packetaCredentials({ packetaApiKey: "ae827fd9b1c0412f" }), { apiKey: "ae827fd9b1c0412f", apiPassword: null });
  const pw = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(packetaCredentials({ packetaApiKey: pw }), { apiKey: null, apiPassword: pw });
  assert.deepEqual(packetaCredentials({ packetaApiKey: "ae827fd9b1c0412f", packetaApiPassword: pw }), { apiKey: "ae827fd9b1c0412f", apiPassword: pw });
});

test("attributes: Z-BOX delivery uses the point id, name split, international phone, RON COD", () => {
  const a = buildPacketAttributes({ order: ORDER, settings: { packetaSender: "Magazin" }, pickupPointId: "22627" });
  assert.equal(a.addressId, "22627");
  assert.equal(a.name, "Ana Maria");
  assert.equal(a.surname, "Popescu");
  assert.equal(a.phone, "+40744555666");
  assert.equal(a.currency, "RON");
  assert.equal(a.cod, "149.90");
  assert.equal(a.number, "1050");
  assert.equal(a.eshop, "Magazin");
  assert.equal(a.street, undefined);
});

test("attributes: home delivery uses the carrier id and splits street / house number", () => {
  const a = buildPacketAttributes({ order: ORDER, settings: {}, pickupPointId: null, homeCarrierId: 4161 });
  assert.equal(a.addressId, "4161");
  assert.equal(a.street, "str. Lalelelor");
  assert.equal(a.houseNumber, "5 bl. A2 ap. 12");
  assert.equal(a.city, "Craiova");
  assert.equal(a.zip, "200585");
  assert.equal(a.province, "Dolj");
});

test("status codes map to Picklo statuses", () => {
  assert.equal(packetaStatus(1), "generated");
  assert.equal(packetaStatus("5"), "out_for_delivery");
  assert.equal(packetaStatus(7), "delivered");
  assert.equal(packetaStatus(10), "returned");
  assert.equal(packetaStatus(18), "returned");
  assert.equal(packetaStatus(24), "failed");
  assert.equal(packetaStatus(11), "cancelled");
});

test("feed rows keep Z-BOX type and coordinates", () => {
  const r = pointToRow({ id: "22627", name: "Z-BOX Popesti", street: "Soseaua Oltenitei 11", city: "Ilfov", zip: "077160", country: "ro", latitude: "44.38", longitude: "26.15" }, "zbox");
  assert.deepEqual([r.externalId, r.type, r.country, r.lat, r.lng], ["22627", "zbox", "ro", 44.38, 26.15]);
});

test("createPacket: XML request and barcode in the response", async () => {
  const m = mockRest((url, body) => {
    assert.ok(body.includes("<createPacket><apiPassword>pw32</apiPassword><packetAttributes>"));
    return ok("<id>4154010000</id><barcode>Z4154010000</barcode><barcodeText>Z 415 4010 000</barcodeText>");
  });
  try {
    const r = await packetaCreatePacket({ apiKey: null, apiPassword: "pw32", order: ORDER, settings: {}, pickupPointId: "22627" });
    assert.deepEqual(r, { success: true, awbNumber: "Z4154010000", packetId: "4154010000", homeDelivery: false, carrierId: null });
    assert.match(m.calls[0].body, /<addressId>22627<\/addressId>/);
    assert.match(m.calls[0].body, /<cod>149\.90<\/cod>/);
  } finally { m.restore(); }
});

test("createPacket: API faults become readable errors", async () => {
  const m = mockRest(() => `<response><status>fault</status><fault>PacketAttributesFault</fault><string>Invalid attributes</string><detail><attributes><fault><name>addressId</name><fault>Final pick up point is not valid.</fault></fault></attributes></detail></response>`);
  try {
    await assert.rejects(packetaCreatePacket({ apiPassword: "pw", order: ORDER, settings: {}, pickupPointId: "1" }), /Packeta \[PacketAttributesFault\]: addressId: punctul sau transportatorul ales nu mai e activ/);
  } finally { m.restore(); }
});

test("label: home delivery prints the carrier label, Z-BOX falls back to the Packeta label", async () => {
  const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
  let m = mockRest((url, body) => (body.includes("packetCourierNumberV2") ? ok("<courierNumber>FAN123</courierNumber><carrierId>762</carrierId>") : ok(pdf)));
  try {
    const buf = await packetaDownloadLabel({ apiPassword: "pw", packetId: "Z4154010000", homeDelivery: true });
    assert.equal(buf.toString().slice(0, 4), "%PDF");
    assert.ok(m.calls.some((c) => c.body.includes("<packetCourierLabelPdf>") && c.body.includes("<courierNumber>FAN123</courierNumber>")));
  } finally { m.restore(); }
  m = mockRest((url, body) => (body.includes("packetCourierNumberV2")
    ? `<response><status>fault</status><fault>NotSupportedFault</fault><string>Packet's address does not support generating courier numbers.</string></response>`
    : ok(pdf)));
  try {
    await packetaDownloadLabel({ apiPassword: "pw", packetId: "4154010000", format: "A6 on A6", homeDelivery: null });
    assert.ok(m.calls.some((c) => c.body.includes("<packetLabelPdf>") && c.body.includes("<format>A6 on A6</format>")));
  } finally { m.restore(); }
});

test("tracking: status records and external carrier history", async () => {
  const m = mockRest((url, body) => body.includes("packetCourierTracking")
    ? ok("<record><dateTime>2026-10-11T09:00:00</dateTime><carrierClass>rofancourier</carrierClass><statusCode>2</statusCode><externalStatusName>In livrare</externalStatusName></record>")
    : ok("<record><dateTime>2026-10-10T10:00:00</dateTime><statusCode>1</statusCode><codeText>received data</codeText><statusText>Am primit datele</statusText></record>"
       + "<record><dateTime>2026-10-10T18:00:00</dateTime><statusCode>6</statusCode><codeText>handed to carrier</codeText><statusText>Predat curierului</statusText></record>"));
  try {
    const ev = await packetaTrackPacket({ apiPassword: "pw", packetId: "4154010000" });
    assert.deepEqual(ev.map((e) => e.status), ["generated", "in_transit", null]);
    assert.equal(ev[2].description, "In livrare");
  } finally { m.restore(); }
});

test("returns: claim with password for drop-off", async () => {
  const m = mockRest(() => ok("<id>4154099999</id><barcode>Z4154099999</barcode><barcodeText>Z 415 4099 999</barcodeText><password>12345678</password>"));
  try {
    const r = await packetaCreateReturn({ apiPassword: "pw", settings: { packetaSender: "Magazin" }, order: ORDER });
    assert.equal(r.password, "12345678");
    assert.match(m.calls[0].body, /<createPacketClaimWithPassword>.*<number>RET1050<\/number>.*<consignCountry>ro<\/consignCountry>.*<sendEmailToCustomer>true<\/sendEmailToCustomer>/s);
  } finally { m.restore(); }
});

test("faults: field-level reasons are shown, COD without a bank account gets a clear hint", async () => {
  const m = mockRest(() => `<response><status>fault</status><fault>PacketAttributesFault</fault><string>Failed to validate attributes. See detail.</string><detail><attributes><fault><name>cod</name><fault>Order nr. 1050: You can not fill in COD because you do not have a bank account number in required currency in your user account.</fault></fault></attributes></detail></response>`);
  try {
    await assert.rejects(packetaCreatePacket({ apiPassword: "pw", order: ORDER, settings: {}, pickupPointId: "1" }), /cod: contul Packeta nu are un cont bancar/);
  } finally { m.restore(); }
});
