// app/services/gls.server.js
// GLS Romania — MyGLS REST API
// Docs: MyGLS_API.pdf (ver. 25.12.11)
// Base URL: https://api.mygls.ro/ParcelService.svc/json/
// Sandbox: https://api.test.mygls.ro/ParcelService.svc/json/
// Auth: Username (email) + Password (SHA512 of password → signed byte array)
// Contact: GLS Romania (gls-romania.ro) to obtain credentials and ClientNumber

import { createHash } from "crypto";

const GLS_PROD    = "https://api.mygls.ro/ParcelService.svc/json";
const GLS_SANDBOX = "https://api.test.mygls.ro/ParcelService.svc/json";

// GLS Delivery Points JSON API — public, no auth required.
// Pattern: https://map.gls-hungary.com/data/deliveryPoints/{country_code}.json
// country_code is lowercase ISO 3166-1 alpha-2 (e.g. "ro", "hu")
const GLS_DELIVERY_POINTS_BASE = "https://map.gls-hungary.com/data/deliveryPoints";

// Countries to fetch (lowercase ISO codes).
// Override with GLS_COUNTRIES env var (comma-separated, e.g. "ro,hu,bg").
// GLS_SHIPIT_COUNTRIES kept as fallback for existing deployments.
const GLS_COUNTRIES = (process.env.GLS_COUNTRIES || process.env.GLS_SHIPIT_COUNTRIES || "ro")
  .split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

function getBase(sandbox = false) {
  return sandbox ? GLS_SANDBOX : GLS_PROD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Password hashing: SHA512(password) → unsigned byte array (0-255)
// C# byte[] is unsigned — do NOT convert to signed values
// ─────────────────────────────────────────────────────────────────────────────
function glsHashPassword(password) {
  const hash = createHash("sha512").update(password, "utf8").digest();
  return Array.from(hash); // unsigned 0-255
}

function glsBuildAuth(username, password) {
  return {
    Username: username,
    Password: glsHashPassword(password),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core helper
// All GLS methods are POST with JSON body
// URL: {base}/{methodName}
// ─────────────────────────────────────────────────────────────────────────────
async function glsRequest(base, method, body) {
  // Log request for debugging (Password is a byte array — truncate for readability)
  const logBody = { ...body, Password: body.Password ? `[${body.Password.length} bytes]` : undefined };
  console.error(`[GLS] POST ${method}`, JSON.stringify(logBody));

  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.error(`[GLS] ${method} response [${res.status}]:`, text.slice(0, 500));
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new Error(`GLS API error [${res.status}] ${method}: ${text}`);
  }

  // GLS returns errors with HTTP 200 but with an error list.
  // The property name is ErrorCode (not Code) — check both for safety.
  const errorList = data.PrintLabelsErrorList || data.GetParcelStatusErrors ||
    data.DeleteLabelsErrorList || data.ErrorList;
  if (errorList?.length > 0) {
    const first = errorList[0];
    const code = first.ErrorCode ?? first.Code ?? 0;
    if (code !== 0) {
      throw new Error(`GLS API error ${code}: ${first.Description || JSON.stringify(first)}`);
    }
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test connection (validate credentials)
// Calls GetParcelStatuses with a dummy parcel number (1).
// GLS validates auth before looking up the parcel, so:
//   - Invalid credentials → ErrorCode 1 "Wrong username or password" → throws
//   - Valid credentials + parcel not found → different error (or empty) → success
// ─────────────────────────────────────────────────────────────────────────────
export async function glsTestConnection({ username, password, sandbox = false }) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);
  try {
    await glsRequest(base, "GetParcelStatuses", {
      ...auth,
      ParcelNumber: 1,
      ReturnPOD: false,
      LanguageIsoCode: "RO",
    });
  } catch (e) {
    // ErrorCode 1 = wrong credentials; anything else (e.g. parcel not found) means auth passed
    if (e.message.includes("GLS API error 1:") ||
        e.message.toLowerCase().includes("password") ||
        e.message.toLowerCase().includes("credentials") ||
        e.message.includes("[401]") || e.message.includes("[403]")) {
      throw new Error(`GLS credentials invalid: ${e.message}`);
    }
    // Non-auth error = credentials are fine
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create parcel + print label in one step
// POST /PrintLabels
// Parcel.ClientNumber = GLS client number (assigned by GLS)
// Returns: ParcelNumber (barcode) and ParcelId (for deletion), plus PDF bytes
// ─────────────────────────────────────────────────────────────────────────────
export async function glsCreateAwb({
  username, password, sandbox = false,
  order,         // customer order data
  settings,      // sender settings (including glsClientNumber)
  clientNumber,  // GLS client number (integer from GLS contract)
  pickupPointId = null,  // GLS ParcelShop ID for locker delivery
  saturdayDelivery = false, // add SAT service code for Saturday delivery
}) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);

  const resolvedClientNumber = clientNumber || parseInt(settings.glsClientNumber) || 0;
  if (!resolvedClientNumber) {
    throw new Error("GLS AWB: Client Number not configured. Set glsClientNumber in Settings → GLS.");
  }

  // Build GLS service list: AOS = ParcelShop delivery, SAT = Saturday delivery
  const glsServiceList = [];
  // PSDParameter must be the goldId integer — string IDs like "RO011857-PARCELSH01" are rejected
  if (pickupPointId) glsServiceList.push({ Code: "AOS", PSDParameter: parseInt(pickupPointId) || String(pickupPointId) });
  if (saturdayDelivery) glsServiceList.push({ Code: "SAT" });

  // GLS rejects '#' and special characters in ClientReference
  const clientReference = (order.shopifyOrderName || "").replace(/^#/, "").replace(/[^a-zA-Z0-9_\-. ]/g, "").trim();

  const parcel = {
    ClientNumber:    resolvedClientNumber,
    ClientReference: clientReference,
    Count:           order.packageCount || 1,
    Weight:          parseFloat(order.weight) || 1,
    ...(order.codAmount > 0 ? {
      CODAmount:    parseFloat(order.codAmount),
      CODReference: (order.shopifyOrderName || "").replace(/^#/, "").replace(/[^a-zA-Z0-9_\-. ]/g, "").trim(),
    } : {}),
    PickupAddress: {
      Name:          settings.senderName    || "",
      Street:        settings.senderAddress || "",
      City:          settings.senderCity    || "",
      ...(settings.senderZip   ? { ZipCode:      settings.senderZip   } : {}),
      CountryIsoCode: "RO",
      ...(settings.senderName  ? { ContactName:  settings.senderName  } : {}),
      ...(settings.senderPhone ? { ContactPhone: settings.senderPhone } : {}),
      ...(settings.senderEmail ? { ContactEmail: settings.senderEmail } : {}),
    },
    DeliveryAddress: {
      Name:          order.customerName     || "",
      Street:        order.shippingAddress1 || "",
      City:          order.shippingCity     || "",
      ...(order.shippingZip    ? { ZipCode:      order.shippingZip    } : {}),
      CountryIsoCode: order.shippingCountry || "RO",
      ...(order.customerName   ? { ContactName:  order.customerName   } : {}),
      ...(order.customerPhone  ? { ContactPhone: order.customerPhone  } : {}),
      ...(order.customerEmail  ? { ContactEmail: order.customerEmail  } : {}),
    },
    ...(glsServiceList.length > 0 ? { ServiceList: glsServiceList } : {}),
  };

  const result = await glsRequest(base, "PrintLabels", {
    ...auth,
    TypeOfPrinter: "A4_2x2",
    PrintPosition: 1,
    ParcelList: [parcel],
  });

  const info = (result.PrintLabelsInfoList || [])[0];
  if (!info?.ParcelNumber) {
    throw new Error(`GLS PrintLabels: no parcel number in response: ${JSON.stringify(result)}`);
  }

  return {
    success: true,
    awbNumber: String(info.ParcelNumber),
    parcelId: info.ParcelId,
    pdfBase64: result.Labels ? Buffer.from(result.Labels, "base64") : null,
    raw: result,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Download label PDF by parcel number
// POST /GetPrintedLabels
// ─────────────────────────────────────────────────────────────────────────────
export async function glsDownloadAwbPdf({ username, password, sandbox = false, awbNumber }) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);

  const result = await glsRequest(base, "GetPrintedLabels", {
    ...auth,
    TypeOfPrinter: "A4_2x2",
    ParcelList: [{ ParcelNumber: parseInt(awbNumber) || awbNumber }],
  });

  if (!result.Labels) {
    throw new Error(`GLS GetPrintedLabels: no label data returned`);
  }
  return Buffer.from(result.Labels, "base64");
}

// ─────────────────────────────────────────────────────────────────────────────
// Track parcel
// POST /GetParcelStatuses
// ─────────────────────────────────────────────────────────────────────────────
export async function glsTrackAwb({ username, password, sandbox = false, awbNumber }) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);

  const result = await glsRequest(base, "GetParcelStatuses", {
    ...auth,
    ParcelNumber: parseInt(awbNumber) || awbNumber,
    ReturnPOD: false,
    LanguageIsoCode: "RO",
  });

  const statuses = result.ParcelStatusList || [];
  return statuses.map((s) => ({
    code: String(s.StatusCode || s.Code || ""),
    description: s.StatusText || s.Description || "",
    date: new Date(s.StatusDate || s.Date || Date.now()),
    location: s.DepotName || s.Location || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete parcel label
// POST /DeleteLabels
// Uses ParcelId (database ID), NOT the ParcelNumber (barcode)
// Store ParcelId in order.awbPdfUrl or use a separate field
// ─────────────────────────────────────────────────────────────────────────────
export async function glsDeleteAwb({ username, password, sandbox = false, parcelId }) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);

  return glsRequest(base, "DeleteLabels", {
    ...auth,
    ParcelIdList: [parseInt(parcelId)],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get parcel shops via GLS public Delivery Points JSON API
// No credentials required — public endpoint, no auth.
// Pattern: https://map.gls-hungary.com/data/deliveryPoints/{country_code}.json
// Response: { items: [ { id, name, contact, location: [lat, lng], type, ... } ] }
// id field = use this in MyGLS API calls (PSDParameter)
// ─────────────────────────────────────────────────────────────────────────────
export async function glsGetPickupPoints() {
  const allPoints = [];

  for (const countryCode of GLS_COUNTRIES) {
    const url = `${GLS_DELIVERY_POINTS_BASE}/${countryCode}.json`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (!res.ok) {
      throw new Error(`GLS Delivery Points API error [${res.status}] GET ${url}`);
    }

    const data = await res.json();
    const items = data.items || (Array.isArray(data) ? data : []);
    allPoints.push(...items.map((s) => ({ ...s, _country: countryCode })));
  }

  return allPoints.map((s) => ({
    externalId: String(s.goldId || s.id || ""),
    courier: "gls",
    type: s.type === "parcel-locker" ? "locker" : "parcelshop",
    name: s.name || "GLS ParcelShop",
    address: s.contact?.address || "",
    city: s.contact?.city || null,
    county: null,
    country: s._country || "ro",
    zip: s.contact?.postalCode || null,
    lat: Array.isArray(s.location) ? (parseFloat(s.location[0]) || null) : null,
    lng: Array.isArray(s.location) ? (parseFloat(s.location[1]) || null) : null,
  }));
}
