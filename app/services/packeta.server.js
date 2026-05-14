// app/services/packeta.server.js
// Packeta (Zásilkovna) REST API v6
// Docs: https://github.com/Packeta/api-documentation
// Base URL: https://www.zasilkovna.cz/api/rest (XML)
// Branches: https://www.zasilkovna.cz/api/v6/{apiKey}/branch.json
// Tracking: https://www.zasilkovna.cz/api/v6/{apiKey}/parcel/{barcode}/statuses
// Auth: API key included in request body (XML) or URL path
// Contact: technicka.podpora@packeta.com for API key

const PACKETA_REST_BASE    = "https://www.zasilkovna.cz/api/rest";
const PACKETA_PICKUP_BASE  = "https://pickup-point.api.packeta.com/v5";
const PACKETA_PARCEL_BASE  = "https://www.zasilkovna.cz/api/v6";

// ─────────────────────────────────────────────────────────────────────────────
// Core XML helper
// Packeta's REST API uses XML request/response
// ─────────────────────────────────────────────────────────────────────────────
async function packetaXmlRequest(endpoint, xmlBody) {
  // Packeta REST API is a single endpoint — method is determined by XML root element
  const res = await fetch(`${PACKETA_REST_BASE}`, {
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
    const detailMatch = text.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
    const detail = detailMatch?.[1]?.replace(/<[^>]+>/g, " ").trim();
    const msg = msgMatch?.[1] || text.slice(0, 400);
    throw new Error(`Packeta API fault: ${msg}${detail ? ` | detail: ${detail}` : ""}`);
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
// Test connection — validate API password via XML endpoint
// Uses packetAttributeValid with dummy data; if credentials are wrong Packeta
// returns "Invalid API password" fault; any other response = credentials OK
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaTestConnection({ apiKey }) {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<createPacketAttributeValid>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <attributes>
    <number>test-conn-001</number>
    <name>Test User</name>
    <email>test@test.com</email>
    <addressId>1</addressId>
    <cod>0</cod>
    <value>1</value>
    <currency>RON</currency>
    <weight>1</weight>
  </attributes>
</createPacketAttributeValid>`;

  const res = await fetch(`${PACKETA_REST_BASE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml, text/xml",
    },
    body: xmlBody,
  });

  const text = await res.text();

  // Invalid API password → explicit fault message
  if (text.toLowerCase().includes("invalid api password") ||
      text.toLowerCase().includes("invalid password") ||
      text.toLowerCase().includes("apipassword")) {
    throw new Error("Packeta API password invalid");
  }

  // Any HTTP error other than auth issues
  if (!res.ok && res.status !== 400 && res.status !== 422) {
    throw new Error(`Packeta API error [${res.status}]`);
  }

  // 400/422 with attribute errors = credentials fine, test data invalid (expected)
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get pickup branches (Z-BOX lockers + Packeta partner points)
// GET https://www.zasilkovna.cz/api/v6/{apiKey}/branch.json
// apiKey = the short API key from client.packeta.com → Settings → API key
// (NOT the API password — that's only for XML REST calls)
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaGetPickupPoints({ apiKey }) {
  const key = encodeURIComponent(apiKey);
  // lang=en returns all countries (lang only affects label language, not which points are returned)
  const [branchRes, boxRes] = await Promise.all([
    fetch(`${PACKETA_PICKUP_BASE}/${key}/branch/json?lang=en`, { headers: { Accept: "application/json" } }),
    fetch(`${PACKETA_PICKUP_BASE}/${key}/box/json?lang=en`,    { headers: { Accept: "application/json" } }),
  ]);

  if (!branchRes.ok) throw new Error(`Packeta branch/json [${branchRes.status}] — check PACKETA_SYNC_API_KEY`);
  if (!boxRes.ok)    throw new Error(`Packeta box/json [${boxRes.status}] — check PACKETA_SYNC_API_KEY`);

  // API may return a plain array OR an object with a data/items/branches key
  const toArray = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      for (const key of ["data", "items", "branches", "boxes", "results"]) {
        if (Array.isArray(raw[key])) return raw[key];
      }
    }
    return [];
  };

  const [rawBranches, rawBoxes] = await Promise.all([branchRes.json(), boxRes.json()]);
  const branches = toArray(rawBranches);
  const boxes    = toArray(rawBoxes);

  // Log raw counts so Railway logs show what the API actually returned
  console.error(`[Packeta] API returned: ${branches.length} branches, ${boxes.length} boxes`);
  if (branches.length > 0) {
    const s = branches[0];
    console.error(`[Packeta] First branch sample: status=${JSON.stringify(s.status)} displayFrontend=${s.displayFrontend} country=${s.country || s.countryCode || s.country_code}`);
  }

  // Accept point if it is active — be permissive when fields are missing/vary by API version
  const isActive = (b) => {
    const status = b.status;
    if (status !== undefined && status !== null) {
      const sid = status?.statusId ?? status;
      if (sid != 1) return false;       // 0, "0", 2, etc. = inactive
    }
    const df = b.displayFrontend;
    if (df !== undefined && df !== null) {
      if (df == 0 || df === false || df === "0") return false;
    }
    return true;
  };

  const mapPoint = (b, type) => ({
    externalId: String(b.id || ""),
    courier: "packeta",
    type,
    name: b.name || "Packeta Point",
    address: [b.street, b.city, b.zip].filter(Boolean).join(", "),
    city: b.city || null,
    county: null,
    // country field may be named differently across API versions
    country: (b.country || b.countryCode || b.country_code || "")?.toLowerCase() || null,
    zip: b.zip || null,
    lat: parseFloat(b.latitude)  || null,
    lng: parseFloat(b.longitude) || null,
  });

  const result = [
    ...branches.filter(isActive).map((b) => mapPoint(b, "packeta_point")),
    ...boxes.filter(isActive).map((b) => mapPoint(b, "zbox")),
  ];
  console.error(`[Packeta] After isActive filter: ${result.length} points (branches: ${branches.filter(isActive).length}, boxes: ${boxes.filter(isActive).length})`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create packet
// POST /createPacket (XML)
// Returns barcode / packet ID
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaCreatePacket({
  apiKey,
  order,      // customer order data
  pickupPointId = null,  // Packeta branch ID for locker/point delivery
}) {
  const isPoint = !!pickupPointId;

  // For home delivery Packeta needs an address (addressId = null and full address)
  // For pickup point delivery: addressId = branch ID, no address needed

  // Packeta <number> must be alphanumeric — strip Shopify's leading '#'
  const orderNumber = (order.shopifyOrderName || order.shopifyOrderId || "")
    .replace(/^#/, "").replace(/[^a-zA-Z0-9_-]/g, "");
  // Packeta requires value >= cod; use at least 1 RON
  const declaredValue = Math.max(order.orderTotal || order.codAmount || 0, 1);

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <packetAttributes>
    <number>${xmlEscape(orderNumber)}</number>
    <name>${xmlEscape(order.customerName || "")}</name>
    <email>${xmlEscape(order.customerEmail || "")}</email>
    <phone>${xmlEscape(order.customerPhone || "")}</phone>
    <cod>${(order.codAmount || 0).toFixed(2)}</cod>
    <value>${declaredValue.toFixed(2)}</value>
    <currency>RON</currency>
    <weight>${(order.weight || 1).toFixed(3)}</weight>
    <eshopOrderNumber>${xmlEscape(order.shopifyOrderName || "")}</eshopOrderNumber>
    ${isPoint
      ? `<addressId>${xmlEscape(String(pickupPointId))}</addressId>`
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
  console.error("[Packeta] createPacket response:", xml.slice(0, 600));

  // Extract barcode and id from response XML
  const idMatch      = xml.match(/<id>\s*(\d+)\s*<\/id>/i);
  const barcodeMatch = xml.match(/<barcode>([^<]+)<\/barcode>/i);
  const trackMatch   = xml.match(/<barcodeText>([^<]+)<\/barcodeText>/i);

  const awbNumber = barcodeMatch?.[1] || trackMatch?.[1] || idMatch?.[1];
  const packetId  = idMatch?.[1] ? String(parseInt(idMatch[1], 10)) : null;

  if (!awbNumber) {
    throw new Error(`Packeta createPacket: no barcode in response: ${xml}`);
  }

  console.error(`[Packeta] created: awbNumber=${awbNumber} packetId=${packetId}`);

  return {
    success: true,
    awbNumber,
    packetId,
    raw: xml,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Download label PDF
// POST /packetLabelPdf (XML) or GET /api/v6/{apiKey}/parcels/print/{id}
// Returns binary PDF buffer
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaDownloadLabel({ apiKey, packetId }) {
  // packetLabelPdf requires the numeric packet ID — barcodes (e.g. Z00012345678) are rejected.
  // If awbPdfUrl was not stored at creation time, re-generate the AWB to get the correct ID.
  const numericId = parseInt(String(packetId), 10);
  if (!numericId || isNaN(numericId)) {
    throw new Error(
      `Packeta PDF: "${packetId}" is not a numeric packet ID (it looks like a barcode). ` +
      `Re-generate the AWB so the numeric ID gets saved.`
    );
  }

  // First attempt: XML REST packetLabelPdf endpoint
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${xmlEscape(apiKey)}</apiPassword>
  <packetId>${numericId}</packetId>
  <offset>0</offset>
</packetLabelPdf>`;

  const res = await fetch(`${PACKETA_REST_BASE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/pdf, application/xml",
    },
    body: xmlBody,
  });

  console.error(`[Packeta] packetLabelPdf [${res.status}] content-type: ${res.headers.get("content-type")}`);

  if (!res.ok) {
    const text = await res.text();
    console.error("[Packeta] packetLabelPdf error body:", text.slice(0, 600));
    throw new Error(`Packeta label download failed [${res.status}]: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("pdf")) {
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Response is XML — log full response for debugging
  const xml = await res.text();
  console.error("[Packeta] packetLabelPdf XML response:", xml.slice(0, 800));

  const statusMatch = xml.match(/<status>([^<]+)<\/status>/i);
  if (statusMatch?.[1] === "fault") {
    const msgMatch = xml.match(/<message[^>]*>([^<]+)<\/message>/i) ||
                     xml.match(/<faultString>([^<]+)<\/faultString>/i) ||
                     xml.match(/<string>([^<]+)<\/string>/i);
    const codeMatch = xml.match(/<code[^>]*>\s*([^<\s]+)\s*<\/code>/i) ||
                      xml.match(/<faultCode>([^<]+)<\/faultCode>/i);
    const msg = msgMatch?.[1] || xml.slice(0, 300);
    throw new Error(`Packeta label fault [${codeMatch?.[1] || "?"}]: ${msg}`);
  }

  // Packeta packetLabelPdf returns base64 PDF inside <result>
  const b64Match = xml.match(/<result>\s*([A-Za-z0-9+/=\r\n]+)\s*<\/result>/i) ||
                   xml.match(/<labelContents>([^<]+)<\/labelContents>/i) ||
                   xml.match(/<packetLabelContents>([^<]+)<\/packetLabelContents>/i) ||
                   xml.match(/<base64PDF>([^<]+)<\/base64PDF>/i);
  if (b64Match?.[1]) {
    return Buffer.from(b64Match[1].replace(/\s/g, ""), "base64");
  }

  throw new Error(`Packeta label: unexpected response format: ${xml.slice(0, 300)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Track packet
// GET /api/v6/{apiKey}/parcel/{barcode}/statuses
// ─────────────────────────────────────────────────────────────────────────────
export async function packetaTrackPacket({ apiKey, awbNumber }) {
  const res = await fetch(
    `${PACKETA_PARCEL_BASE}/${apiKey}/parcel/${encodeURIComponent(awbNumber)}/statuses`,
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
