// app/services/sameday.server.js
// Sameday Courier RESTful API
// PROD:    https://api.sameday.ro
// SANDBOX: https://sameday-api.demo.zitec.com
// Contact: software@sameday.ro to request API credentials
// Token TTL: 12h (or permanent with remember_me=1)

const SAMEDAY_PROD = "https://api.sameday.ro";
const SAMEDAY_SANDBOX = "https://sameday-api.demo.zitec.com";

// Token cache: username → { token, expiresAt }
const tokenCache = new Map();

function getBase(sandbox = false) {
  return sandbox ? SAMEDAY_SANDBOX : SAMEDAY_PROD;
}

function getCachedToken(username, sandbox) {
  const key = `${username}:${sandbox}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  return null;
}

function setCachedToken(username, sandbox, token, ttlSeconds = 43200) {
  const key = `${username}:${sandbox}`;
  tokenCache.set(key, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core helper
// ─────────────────────────────────────────────────────────────────────────────
async function samedayRequest(base, path, { method = "GET", token, body, form } = {}) {
  const headers = {
    Accept: "application/json",
    ...(token ? { "X-AUTH-TOKEN": token } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
  };

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new Error(`Sameday API error [${res.status}] ${path}: ${text}`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// POST /api/authenticate
// Headers: X-AUTH-USERNAME, X-AUTH-PASSWORD, X-AUTH-APP-ID
// X-AUTH-APP-ID: 8 = third-party e-commerce integration (WooCommerce, custom API)
//                2 = Sameday's own eAWB web interface
// Returns: { token, expire_at_utc }
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayAuthenticate({ username, password, sandbox = false }) {
  const cached = getCachedToken(username, sandbox);
  if (cached) return cached;

  const base = getBase(sandbox);

  // X-AUTH-APP-ID identifies the calling application to Sameday.
  // 2 = eAWB web, 8 = third-party e-commerce (WooCommerce etc.).
  // xConnector and other platforms may use a different registered ID.
  // Try all known values so merchant credentials work regardless of how
  // their Sameday account was configured.
  const APP_IDS = ["2", "8", "1", "3", "4", "5", "6", "7", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"];
  let lastResponse = null;

  for (const appId of APP_IDS) {
    try {
      const res = await fetch(`${base}/api/authenticate`, {
        method: "POST",
        headers: {
          "X-AUTH-USERNAME": username,
          "X-AUTH-PASSWORD": password,
          "X-AUTH-APP-ID": appId,
          Accept: "application/json",
        },
      });

      // Use text() first — some app IDs may return HTML error pages
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        console.error(`[Sameday] Auth APP-ID ${appId}: non-JSON response [${res.status}] ${text.slice(0, 120)}`);
        continue;
      }

      lastResponse = data;
      if (data.token) {
        // expire_at_utc may be a Unix timestamp (seconds) or an ISO string — handle both
        let ttl = 43200;
        if (data.expire_at_utc) {
          const expMs = typeof data.expire_at_utc === "number"
            ? data.expire_at_utc * 1000
            : new Date(data.expire_at_utc).getTime();
          if (!isNaN(expMs)) ttl = Math.max(300, Math.floor((expMs - Date.now()) / 1000) - 300);
        }
        setCachedToken(username, sandbox, data.token, ttl);
        console.log(`[Sameday] Auth success APP-ID ${appId} for ${username} (ttl=${ttl}s)`);
        return data.token;
      }
    } catch (e) {
      console.error(`[Sameday] Auth APP-ID ${appId} threw: ${e.message}`);
      continue;
    }
  }

  throw new Error(
    "Sameday autentificare eșuată — credențialele nu sunt valide sau nu au acces API. " +
    "Contactați Sameday la software@sameday.ro pentru activarea accesului API REST. " +
    `Ultimul răspuns: ${JSON.stringify(lastResponse)}`
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Get client pickup points (YOUR warehouse/sender locations)
// GET /api/client/pickup-points
// These are YOUR sender addresses, not the recipient lockers!
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetClientPickupPoints({ username, password, sandbox = false }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);
  const data = await samedayRequest(base, "/api/client/pickup-points?perPage=100", { token });
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Get OOH locations (easybox lockers + PUDO points)
// Production: GET /api/client/ooh-locations (API v3.1+)
// Sandbox / older contracts: falls back to /api/geolocation/pickup-points then /api/locker/list
// oohType 0 = easybox, 1 = PUDO
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetLockers({ username, password, sandbox = false }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  // ── Try new OOH endpoint (production API v3.1+) ─────────────────────────
  try {
    let allItems = [];
    let page = 1;
    let totalPages = 1;

    do {
      const params = new URLSearchParams({
        countPerPage: "500",
        page: String(page),
      });
      const data = await samedayRequest(base, `/api/client/ooh-locations?${params}`, { token });
      const items = data.data || [];
      allItems.push(...items);
      totalPages = data.pages || 1;
      page++;
    } while (page <= totalPages && page <= 20);

    return allItems
      // Accept if clientVisible is absent, null, or any truthy/non-zero value.
      // The strict === 1 check excluded boolean true (returned by some API versions).
      .filter((l) => l.clientVisible == null || l.clientVisible != 0)
      .map((l) => ({
        externalId: String(l.oohId),
        courier: "sameday",
        type: l.oohType === 0 ? "easybox" : "pudo",
        name: l.name || "Sameday easybox",
        address: l.address || "",
        city: l.city || null,
        county: l.county || null,
        zip: l.postalCode || null,
        lat: l.lat ? parseFloat(l.lat) : null,
        lng: l.lng ? parseFloat(l.lng) : null,
      }));
  } catch (oohErr) {
    // OOH endpoint not available on sandbox or older API contracts — fall back
    if (!oohErr.message?.includes("[404]") && !oohErr.message?.includes("[400]") &&
        !oohErr.message?.includes("[403]") && !oohErr.message?.includes("[405]")) {
      throw oohErr; // unexpected error — propagate
    }
  }

  // ── Fallback: older geolocation endpoint (sandbox / legacy contracts) ────
  try {
    const params = new URLSearchParams({ perPage: "500", type: "2" });
    const data = await samedayRequest(base, `/api/geolocation/pickup-points?${params}`, { token });
    const items = data.data || (Array.isArray(data) ? data : []);
    if (items.length > 0) {
      return items.map((l) => ({
        externalId: String(l.id),
        courier: "sameday",
        type: "easybox",
        name: l.name || l.alias || "Sameday easybox",
        address: l.address || "",
        city: l.city?.name || l.city || null,
        county: l.county?.name || l.county || null,
        zip: l.postalCode || null,
        lat: parseFloat(l.lat) || null,
        lng: parseFloat(l.long || l.lng || l.lon) || null,
      }));
    }
  } catch (_) { /* try next fallback */ }

  // ── Final fallback: locker list endpoint ────────────────────────────────
  try {
    const data = await samedayRequest(base, "/api/locker/list?perPage=500", { token });
    const items = data.data || [];
    return items.map((l) => ({
      externalId: String(l.id),
      courier: "sameday",
      type: "easybox",
      name: l.name || l.alias || "Sameday easybox",
      address: l.address || "",
      city: l.city?.name || l.city || null,
      county: l.county?.name || l.county || null,
      zip: l.postalCode || null,
      lat: parseFloat(l.lat) || null,
      lng: parseFloat(l.long || l.lng || l.lon) || null,
    }));
  } catch (_) {
    return []; // sandbox with no locker data — return empty silently
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Get available services for your contract
// GET /api/client/services
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetServices({ username, password, sandbox = false }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);
  const data = await samedayRequest(base, "/api/client/services?perPage=100", { token });
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Get counties (for address mapping)
// GET /api/geolocation/county
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetCounties({ username, password, sandbox = false }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);
  const data = await samedayRequest(base, "/api/geolocation/county?perPage=100", { token });
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Get cities in a county
// GET /api/geolocation/city?county=COUNTY_ID
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetCities({ username, password, sandbox = false, countyId }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);
  const data = await samedayRequest(
    base,
    `/api/geolocation/city?county=${countyId}&perPage=500`,
    { token }
  );
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculate shipping price
// POST /api/price
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayCalculatePrice({
  username, password, sandbox = false,
  pickupPointId,  // your sender pickup point id
  serviceId,      // from getServices()
  destCountyId,   // recipient county id
  destCityId,     // recipient city id (optional)
  weight,
  codAmount = 0,
}) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const data = await samedayRequest(base, "/api/price", {
    method: "POST",
    token,
    body: {
      pickupPoint: pickupPointId,
      service: serviceId,
      packageType: 1, // 1 = package
      weight,
      insuredValue: 0,
      cashOnDelivery: codAmount,
      county: destCountyId,
      ...(destCityId ? { locality: destCityId } : {}),
    },
  });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create AWB
// POST /api/awb
// Service codes: "T" = Standard, "LN" = Locker NextDay (easybox delivery)
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayCreateAwb({
  username, password, sandbox = false,
  order,         // customer order data
  settings,      // sender settings
  senderPickupPointId,  // YOUR pickup point id (from samedayGetClientPickupPoints)
  lockerDestId = null,  // easybox locker id (if pickup_point delivery)
  serviceId,            // from samedayGetServices()
  serviceCode,          // e.g. "T" or "LN"
  openPackage = false,  // allow recipient to inspect before accepting
  insuredValue = 0,     // declared value for insurance
}) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const isLocker = !!lockerDestId;
  const count = order.packageCount || 1;
  const weightPerParcel = parseFloat(order.weight || 1) / count;

  const payload = {
    pickupPoint: senderPickupPointId,
    packageType: 1,
    packageNumber: count,
    packageWeight: parseFloat(order.weight || 1),
    // Sameday API v3.1 requires parcels array (min 1 element)
    parcels: Array.from({ length: count }, (_, i) => ({
      sequenceNo: i + 1,
      weight: Math.round(weightPerParcel * 1000) / 1000,
    })),
    service: serviceId,
    awbPayment: 1,
    cashOnDelivery: order.codAmount || 0,
    cashOnDeliveryReturns: order.codAmount > 0 ? 1 : 0,
    insuredValue: insuredValue || 0,
    thirdPartyPickup: 0,
    observation: order.notes || "",
    clientReference: order.shopifyOrderName || "",
    // Recipient
    awbRecipient: {
      name: order.customerName,
      phoneNumber: order.customerPhone,
      personType: 0,        // 0 = individual, 1 = company — required
      email: order.customerEmail || "",
      address: order.shippingAddress1 || "",
      postalCode: order.shippingZip || "",
      // For locker delivery oohLastMile identifies the destination — omit county/city
      // to avoid ID validation errors (different contracts accept different IDs).
      // For home delivery, use plain strings (countyString/cityString) which are
      // accepted by all contract types without strict ID validation.
      ...(!isLocker && order.shippingCounty ? { countyString: order.shippingCounty } : {}),
      ...(!isLocker && order.shippingCity   ? { cityString:   order.shippingCity   } : {}),
    },
    // If OOH delivery (easybox/PUDO), use oohLastMile (lockerId is deprecated)
    ...(isLocker ? { oohLastMile: String(lockerDestId) } : {}),
    ...(openPackage ? { openPackage: 1 } : {}),
  };

  console.error("[Sameday] /api/awb payload:", JSON.stringify(payload));
  const data = await samedayRequest(base, "/api/awb", {
    method: "POST",
    token,
    body: payload,
  });

  console.error("[Sameday] /api/awb full response:", JSON.stringify(data));

  if (data.awbNumber) {
    return {
      success: true,
      awbNumber: String(data.awbNumber),
      pdfLink: data.pdfLink || null,
      raw: data,
    };
  }

  throw new Error(`Sameday AWB generation failed: ${JSON.stringify(data)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Download AWB PDF
// GET /api/awb/{awbNumber}/download
// Returns binary PDF
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayDownloadAwbPdf({ username, password, sandbox = false, awbNumber }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const res = await fetch(`${base}/api/awb/download/${awbNumber}`, {
    headers: { "X-AUTH-TOKEN": token, Accept: "application/pdf" },
  });

  if (!res.ok) throw new Error(`Sameday PDF download failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Track AWB
// GET /api/client/awb/{awbNumber}/status/history
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayTrackAwb({ username, password, sandbox = false, awbNumber }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const data = await samedayRequest(
    base,
    `/api/client/awb/${awbNumber}/status/history`,
    { token }
  );

  const history = data.data || data.awbHistory || [];
  return history.map((e) => ({
    code: String(e.statusState || e.status || ""),
    description: e.statusStateDescription || e.label || e.description || "",
    date: new Date(e.statusDate || e.date),
    location: e.transitLocation || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete AWB
// DELETE /api/awb/{awbNumber}
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayDeleteAwb({ username, password, sandbox = false, awbNumber }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);
  return samedayRequest(base, `/api/awb/${awbNumber}`, { method: "DELETE", token });
}
