// app/services/packeta.server.js
// Packeta (Zásilkovna) REST API v6
// Docs: https://github.com/Packeta/api-documentation
// Base URL: https://www.zasilkovna.cz/api/rest (XML)
// Branches: https://www.zasilkovna.cz/api/v6/{apiKey}/branch.json
// Tracking: https://www.zasilkovna.cz/api/v6/{apiKey}/parcel/{barcode}/statuses
// Auth: API key included in request body (XML) or URL path
// Contact: technicka.podpora@packeta.com for API key

const PACKETA_REST_BASE    = "https://www.zasilkovna.cz/api/rest";
const PACKETA_BRANCH_BASE  = "https://www.zasilkovna.cz/api/v6";

// ─────────────────────────────────────────────────────────────────────────────
// Core XML helper
// Packeta's REST API uses XML request/response
// ─────────────────────────────────────────────────────────────────────────────
async function packetaXmlRequest(endpoint, xmlBody) {
  const res = await fetch(`${PACKETA_REST_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml, text/xml",
    },
    body: xmlBody,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Packeta API error [${res.status}] ${endpoint}: ${text}`);
  }

  // Parse status from XML
  const statusMatch = text.match(/<status>([^<]+)<\/status>/i);
  const status = statusMatch?.[1];

  if (status && status !== "ok") {
    const msgMatch = text.match(/<message[^>]*>([^<]+)<\/message>/i) ||
                     text.match(/<string>([^<]+)<\/string>/i);
    throw new Error(`Packeta API fault: ${msgMatch?.[1] || text}`);
  }

  return text; // raw XML — caller extracts what they need
}

function xmlEscape(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Get pickup branches (Z-BOX lockers + Packeta partner points)
// GET /api/v6/{apiKey}/branch.json?lang=en
// Returns ALL worldwide branches — filter by country field in response
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaGetPickupPoints({ apiKey }) {
  const res = await fetch(
    `${PACKETA_BRANCH_BASE}/${apiKey}/branch.json?lang=en`,
    { headers: { Accept: "application/json" } }
  );

  if (!res.ok) {
    throw new Error(`Packeta branches error [${res.status}]`);
  }

  const data = await res.json();
  const branches = data.branches || (Array.isArray(data) ? data : []);

  return branches
    .filter((b) =>
      // Only Romanian branches, active and publicly accessible
      (b.country === "ro" || b.country === "RO") &&
      b.status === 1 &&
      (b.place === "depot" || b.place === "zbox" || !b.place)
    )
    .map((b) => ({
      id: String(b.id),
      externalId: String(b.id),
      courier: "packeta",
      type: b.pickupPointType === "zbox" || b.place === "zbox" ? "zbox" : "packeta_point",
      name: b.name || b.nameStreet || "Packeta Point",
      address: [b.street, b.city, b.zip].filter(Boolean).join(", "),
      city: b.city || null,
      county: b.county || b.region || null,
      zip: b.zip || null,
      lat: parseFloat(b.latitude)  || null,
      lng: parseFloat(b.longitude) || null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Create packet
// POST /createPacket (XML)
// Returns barcode / packet ID
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaCreatePacket({
  apiKey,
  order,      // customer order data
  settings,   // sender settings (senderName, senderEmail)
  pickupPointId = null,  // Packeta branch ID for locker/point delivery
}) {
  const isPoint = !!pickupPointId;

  // For home delivery Packeta needs an address (addressId = null and full address)
  // For pickup point delivery: addressId = branch ID, no address needed

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <packetAttributes>
    <number>${xmlEscape(order.shopifyOrderName || order.shopifyOrderId || "")}</number>
    <name>${xmlEscape(order.customerName || "")}</name>
    <email>${xmlEscape(order.customerEmail || "")}</email>
    <phone>${xmlEscape(order.customerPhone || "")}</phone>
    <cod>${(order.codAmount || 0).toFixed(2)}</cod>
    <value>${(order.orderTotal || order.codAmount || 0).toFixed(2)}</value>
    <currency>RON</currency>
    <weight>${(order.weight || 1).toFixed(3)}</weight>
    <eshopOrderNumber>${xmlEscape(order.shopifyOrderName || "")}</eshopOrderNumber>
    ${isPoint
      ? `<addressId>${xmlEscape(pickupPointId)}</addressId>`
      : `<street>${xmlEscape(order.shippingAddress1 || "")}</street>
    <city>${xmlEscape(order.shippingCity || "")}</city>
    <zip>${xmlEscape(order.shippingZip || "")}</zip>
    <countryCode>${xmlEscape(order.shippingCountry || "RO")}</countryCode>`
    }
    <returnGoodsEnabled>0</returnGoodsEnabled>
    <note>${xmlEscape(order.notes || "")}</note>
  </packetAttributes>
</createPacket>`;

  const xml = await packetaXmlRequest("createPacket", xmlBody);

  // Extract barcode and id from response XML
  const idMatch      = xml.match(/<id>([^<]+)<\/id>/i);
  const barcodeMatch = xml.match(/<barcode>([^<]+)<\/barcode>/i);
  const trackMatch   = xml.match(/<barcodeText>([^<]+)<\/barcodeText>/i);

  const awbNumber = barcodeMatch?.[1] || trackMatch?.[1] || idMatch?.[1];

  if (!awbNumber) {
    throw new Error(`Packeta createPacket: no barcode in response: ${xml}`);
  }

  return {
    success: true,
    awbNumber,
    packetId: idMatch?.[1] || null,
    raw: xml,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Download label PDF
// POST /packetLabelPdf (XML) or GET /api/v6/{apiKey}/parcels/print/{id}
// Returns binary PDF buffer
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaDownloadLabel({ apiKey, packetId, format = "A6 on A4" }) {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <packetId>${xmlEscape(String(packetId))}</packetId>
  <offset>0</offset>
</packetLabelPdf>`;

  const res = await fetch(`${PACKETA_REST_BASE}/packetLabelPdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/pdf, application/xml",
    },
    body: xmlBody,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Packeta label download failed [${res.status}]: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("pdf")) {
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Response is XML with base64 PDF
  const xml = await res.text();
  const b64Match = xml.match(/<labelContents>([^<]+)<\/labelContents>/i) ||
                   xml.match(/<base64PDF>([^<]+)<\/base64PDF>/i);
  if (b64Match?.[1]) {
    return Buffer.from(b64Match[1], "base64");
  }

  throw new Error(`Packeta label: unexpected response format: ${xml.slice(0, 300)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Track packet
// GET /api/v6/{apiKey}/parcel/{barcode}/statuses
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaTrackPacket({ apiKey, awbNumber }) {
  const res = await fetch(
    `${PACKETA_BRANCH_BASE}/${apiKey}/parcel/${encodeURIComponent(awbNumber)}/statuses`,
    { headers: { Accept: "application/json" } }
  );

  if (!res.ok) {
    // Fallback: try the REST XML endpoint
    return packetaTrackPacketXml({ apiKey, awbNumber });
  }

  const data = await res.json();
  const statuses = data.statuses || (Array.isArray(data) ? data : []);

  return statuses.map((s) => ({
    code: String(s.code || s.codeText || ""),
    description: s.stateText || s.description || s.text || "",
    date: new Date(s.dateTime || s.date || Date.now()),
    location: s.depot || s.location || null,
  }));
}

async function packetaTrackPacketXml({ apiKey, awbNumber }) {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<packetTracking>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <barcode>${xmlEscape(awbNumber)}</barcode>
</packetTracking>`;

  const xml = await packetaXmlRequest("packetTracking", xmlBody);

  // Parse events from XML
  const events = [];
  const eventRegex = /<statusRecord[^>]*>([\s\S]*?)<\/statusRecord>/gi;
  let match;
  while ((match = eventRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"))?.[1] || "";
    events.push({
      code: get("statusCode") || get("code"),
      description: get("text") || get("description") || get("statusText"),
      date: new Date(get("dateTime") || get("date") || Date.now()),
      location: get("depot") || get("location") || null,
    });
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel / delete packet
// POST /cancelPacket (XML) — only possible before shipment
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaDeletePacket({ apiKey, packetId }) {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<cancelPacket>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <packetId>${xmlEscape(String(packetId))}</packetId>
</cancelPacket>`;

  return packetaXmlRequest("cancelPacket", xmlBody);
}
