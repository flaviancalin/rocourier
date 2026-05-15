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
// Central: https://map.gls-hungary.com/data/deliveryPoints/{country_code}.json
// Regional: some GLS subsidiaries host their own data on country-specific domains.
//   e.g. Romania → map.gls-romania.com, Bulgaria → map.gls-bulgaria.com
// We try the regional URL first (primary), then fall back to the central Hungary URL.
const GLS_DELIVERY_POINTS_CENTRAL = "https://map.gls-hungary.com/data/deliveryPoints";

// Countries known to use their own regional delivery-points domain.
// Format: countryCode → base URL of their regional map (same JSON format as central).
const GLS_REGIONAL_BASES = {
  ro: "https://map.gls-romania.com/data/deliveryPoints",
  bg: "https://map.gls-bulgaria.com/data/deliveryPoints",
  hr: "https://map.gls-croatia.com/data/deliveryPoints",
  rs: "https://map.gls-serbia.com/data/deliveryPoints",
  ba: "https://map.gls-bih.com/data/deliveryPoints",
};

// All European countries where GLS operates parcel shops / lockers.
// Override with GLS_COUNTRIES env var (comma-separated) to restrict.
const GLS_ALL_EU_COUNTRIES = [
  "al","at","be","ba","bg","hr","cy","cz","dk","ee",
  "fi","fr","de","gr","hu","ie","it","lv","lt","lu",
  "mt","nl","no","pl","pt","ro","rs","sk","si","es",
  "se","ch","gb",
];
// All EU countries by default. Override with GLS_COUNTRIES env var (e.g. "ro,hu,bg") to restrict.
const GLS_COUNTRIES = (process.env.GLS_COUNTRIES || process.env.GLS_SHIPIT_COUNTRIES)
  ? (process.env.GLS_COUNTRIES || process.env.GLS_SHIPIT_COUNTRIES)
      .split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
  : GLS_ALL_EU_COUNTRIES;

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
      throw new Error(`GLS API error ${code}: ${first.ErrorDescription || first.Description || JSON.stringify(first)}`);
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

  // Build GLS service list: PSD = ParcelShop delivery, SAT = Saturday delivery
  // PSDParameter MUST be an object { StringValue: "..." } — WCF rejects plain integers.
  const glsServiceList = [];
  if (pickupPointId) {
    const goldId = String(pickupPointId).trim();
    if (!goldId) {
      throw new Error(
        `GLS: ParcelShop ID "${pickupPointId}" is empty. ` +
        `Re-sync pickup points from admin → Puncte de ridicare → Reîmprospătează.`
      );
    }
    glsServiceList.push({ Code: "PSD", PSDParameter: { StringValue: goldId } });
  }
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
    TypeOfPrinter: 1,
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
    TypeOfPrinter: 1,
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

// Helper: fetch from one URL, return items array
async function fetchGlsUrl(url, countryCode) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null; // null = not available
  const data = await res.json();
  return data.items || (Array.isArray(data) ? data : []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Get parcel shops via GLS public Delivery Points JSON API
// No credentials required — public endpoint, no auth.
// For countries with a regional GLS domain (e.g. Romania → map.gls-romania.com),
// the central Hungary API returns 0 — try regional first, fall back to central.
// Response format: { items: [ { id, name, contact, location: [lat, lng], type, ... } ] }
// ─────────────────────────────────────────────────────────────────────────────
export async function glsGetPickupPoints() {
  console.error(`[GLS] Fetching delivery points for ${GLS_COUNTRIES.length} countries in parallel`);
  const settled = await Promise.allSettled(
    GLS_COUNTRIES.map(async (countryCode) => {
      const regionalBase = GLS_REGIONAL_BASES[countryCode];
      let items = null;

      // Try regional domain first for countries that host their own data
      if (regionalBase) {
        const regionalUrl = `${regionalBase}/${countryCode}.json`;
        items = await fetchGlsUrl(regionalUrl, countryCode).catch(() => null);
        if (items !== null) {
          console.error(`[GLS] ${countryCode.toUpperCase()}: ${items.length} points (regional)`);
        }
      }

      // Fall back to the central Hungary domain
      if (items === null || items.length === 0) {
        const centralUrl = `${GLS_DELIVERY_POINTS_CENTRAL}/${countryCode}.json`;
        const centralItems = await fetchGlsUrl(centralUrl, countryCode).catch(() => null);
        if (centralItems !== null && centralItems.length > (items?.length ?? 0)) {
          items = centralItems;
          if (items.length > 0 || countryCode === "ro") {
            console.error(`[GLS] ${countryCode.toUpperCase()}: ${items.length} points (central)`);
          }
        }
      }

      if (!items || items.length === 0) {
        if (countryCode === "ro") console.error(`[GLS] RO: 0 points from both regional and central`);
        return [];
      }

      return items.map((s) => ({ ...s, _country: countryCode }));
    })
  );

  const allPoints = settled.flatMap((r) => {
    if (r.status === "fulfilled") return r.value;
    console.error("[GLS] Country fetch error:", r.reason?.message);
    return [];
  });

  return allPoints
    .map((s) => ({
      // Use the string id (e.g. "RO021196-PARCELSHOP") as externalId — this is what
      // GLS API expects as PSDParameter.StringValue. goldId is numeric and rejected.
      externalId: s.id || String(s.goldId || ""),
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
    }))
    // Drop points with missing or out-of-Europe coordinates (bad data in GLS's own DB).
    // Bounds cover all GLS markets incl. Canary Islands (lat ~28, lng ~-16) and Cyprus (lat ~35, lng ~34).
    .filter((p) => p.lat && p.lng && p.lat >= 27 && p.lat <= 72 && p.lng >= -30 && p.lng <= 45);
}
