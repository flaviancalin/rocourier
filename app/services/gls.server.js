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

function getBase(sandbox = false) {
  return sandbox ? GLS_SANDBOX : GLS_PROD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Password hashing: SHA512(password) → signed byte array
// The GLS API expects Password as byte[] (signed int values, -128..127)
// ─────────────────────────────────────────────────────────────────────────────
function glsHashPassword(password) {
  const hash = createHash("sha512").update(password, "utf8").digest();
  // Convert to signed byte array (Java/C# signed byte convention)
  return Array.from(hash).map((b) => (b > 127 ? b - 256 : b));
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
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new Error(`GLS API error [${res.status}] ${method}: ${text}`);
  }

  // Check for GLS error info in response
  const errorList = data.PrintLabelsErrorList || data.GetParcelStatusErrors ||
    data.DeleteLabelsErrorList || data.ErrorList;
  if (errorList?.length > 0) {
    const first = errorList[0];
    if (first.Code > 0) {
      throw new Error(`GLS API error ${first.Code}: ${first.Description || JSON.stringify(first)}`);
    }
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test connection (validate credentials)
// ─────────────────────────────────────────────────────────────────────────────
export async function glsTestConnection({ username, password, sandbox = false }) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);
  // Attempt a GetParcelStatuses call with dummy data — will fail with API error but auth error is different
  // Actually better to use GetClientReturnAddress which just needs credentials
  try {
    await glsRequest(base, "GetClientReturnAddress", {
      ...auth,
      GetClientReturnAddressRequest: {},
    });
  } catch (e) {
    // If the error is about credentials (auth error), rethrow
    if (e.message.includes("401") || e.message.toLowerCase().includes("auth") ||
        e.message.toLowerCase().includes("unauthorized")) {
      throw e;
    }
    // Other errors (e.g., missing client number) mean auth passed
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
}) {
  const base = getBase(sandbox);
  const auth = glsBuildAuth(username, password);

  const parcel = {
    ClientNumber:    clientNumber || parseInt(settings.glsClientNumber) || 0,
    ClientReference: order.shopifyOrderName || "",
    Count:           order.packageCount || 1,
    ...(order.codAmount > 0 ? {
      CODAmount:    order.codAmount,
      CODReference: order.shopifyOrderName || "",
      CODCurrency:  "RON",
    } : {}),
    PickupAddress: {
      Name:          settings.senderName    || "",
      Street:        settings.senderAddress || "",
      City:          settings.senderCity    || "",
      ZipCode:       settings.senderZip     || "",
      CountryIsoCode: "RO",
      ContactName:   settings.senderName    || "",
      ContactPhone:  settings.senderPhone   || "",
      ContactEmail:  settings.senderEmail   || "",
    },
    DeliveryAddress: {
      Name:          order.customerName     || "",
      Street:        order.shippingAddress1 || "",
      City:          order.shippingCity     || "",
      ZipCode:       order.shippingZip      || "",
      CountryIsoCode: order.shippingCountry || "RO",
      ContactName:   order.customerName     || "",
      ContactPhone:  order.customerPhone    || "",
      ContactEmail:  order.customerEmail    || "",
    },
    // GLS ParcelShop delivery (Service AOS)
    ...(pickupPointId ? {
      ServiceList: [
        {
          Code: "AOS",
          PSDParameter: String(pickupPointId),
        },
      ],
    } : {}),
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
// Get parcel shops via GLS ShipIT REST API
// The MyGLS parcel management API has no shop endpoint. GLS provides parcel
// shop locations through a separate ShipIT REST API:
//   GET {shipItUrl}/country/RO
//   Auth: Basic Auth (same username/password as MyGLS)
//   Headers: Accept: application/glsVersion1+json, application/json
// The exact base URL (shipItUrl) is provided by GLS Romania with your contract.
// Example: https://shipit.gls-group.eu/backend/rs/parcelshop
// ─────────────────────────────────────────────────────────────────────────────
export async function glsGetPickupPoints({ username, password, shipItUrl }) {
  if (!shipItUrl) return [];

  const base = shipItUrl.replace(/\/$/, "");
  const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");

  const res = await fetch(`${base}/country/RO`, {
    headers: {
      Accept: "application/glsVersion1+json, application/json",
      Authorization: `Basic ${basicAuth}`,
    },
  });

  if (!res.ok) {
    throw new Error(`GLS ShipIT error [${res.status}] GET /country/RO`);
  }

  const data = await res.json();
  const shops = Array.isArray(data) ? data : (data.parcelShopList || data.parcelShops || []);

  return shops.map((s) => ({
    id: String(s.parcelShopId || s.id || s.Id),
    externalId: String(s.parcelShopId || s.id || s.Id),
    courier: "gls",
    type: "parcelshop",
    name: s.name || s.companyName || "GLS ParcelShop",
    address: [s.address?.street, s.address?.city, s.address?.countryCode]
      .filter(Boolean).join(", ") ||
      [s.street, s.city].filter(Boolean).join(", "),
    city: s.address?.city || s.city || null,
    county: s.address?.region || s.county || null,
    zip: s.address?.zipCode || s.zip || null,
    lat: parseFloat(s.position?.latitude  || s.latitude)  || null,
    lng: parseFloat(s.position?.longitude || s.longitude) || null,
  }));
}
