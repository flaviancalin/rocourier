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
// Headers: X-AUTH-USERNAME, X-AUTH-PASSWORD, X-AUTH-APP-ID (use 2 for WEB)
// Returns: { token, expire_at_utc }
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayAuthenticate({ username, password, sandbox = false }) {
  const cached = getCachedToken(username, sandbox);
  if (cached) return cached;

  const base = getBase(sandbox);
  const res = await fetch(`${base}/api/authenticate`, {
    method: "POST",
    headers: {
      "X-AUTH-USERNAME": username,
      "X-AUTH-PASSWORD": password,
      "X-AUTH-APP-ID": "2", // 2 = WEB platform
      Accept: "application/json",
    },
  });

  const data = await res.json();

  if (!data.token) {
    throw new Error(`Sameday auth failed: ${JSON.stringify(data)}`);
  }

  // expire_at_utc is a Unix timestamp in seconds
  const ttl = data.expire_at_utc
    ? data.expire_at_utc - Math.floor(Date.now() / 1000) - 300
    : 43200;

  setCachedToken(username, sandbox, data.token, ttl);
  return data.token;
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
// Get easybox LOCKERS (customer delivery destinations)
// GET /api/locker/list  ← public endpoint for locker locations
// or GET /api/geolocation/pickup-points (if available on your contract)
// Type 1 = lockers, Type 2 = PUDO points
// ─────────────────────────────────────────────────────────────────────────────
export async function samedayGetLockers({ username, password, sandbox = false, county = null }) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const params = new URLSearchParams({ perPage: 500 });
  if (county) params.append("county", county);

  const data = await samedayRequest(base, `/api/locker/list?${params}`, { token });
  const lockers = data.data || [];

  return lockers.map((l) => ({
    id: String(l.id),
    externalId: String(l.id),
    courier: "sameday",
    type: "easybox",
    name: l.name || l.alias || "Sameday easybox",
    address: [l.address, l.city?.name || l.city, l.county?.name || l.county]
      .filter(Boolean)
      .join(", "),
    city: l.city?.name || l.city,
    county: l.county?.name || l.county,
    zip: l.postalCode || null,
    lat: parseFloat(l.lat) || null,
    lng: parseFloat(l.long || l.lng || l.lon) || null,
    boxSizes: l.boxes || [],
  }));
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
  countyId,             // recipient county id
  cityId,               // recipient city id
}) {
  const token = await samedayAuthenticate({ username, password, sandbox });
  const base = getBase(sandbox);

  const isLocker = !!lockerDestId;

  const payload = {
    pickupPoint: senderPickupPointId,
    packageType: 1,        // 1 = colet
    packageNumber: order.packageCount || 1,
    packageWeight: order.weight || 1,
    service: serviceId,
    awbPayment: 1,         // 1 = recipient pays transport
    cashOnDelivery: order.codAmount || 0,
    cashOnDeliveryReturns: order.codAmount > 0 ? 1 : 0,
    insuredValue: 0,
    thirdPartyPickup: 0,
    observation: order.notes || "",
    clientReference: order.shopifyOrderName || "",
    // Recipient
    awbRecipient: {
      name: order.customerName,
      phoneNumber: order.customerPhone,
      email: order.customerEmail || "",
      address: isLocker ? "" : (order.shippingAddress1 || ""),
      locality: cityId ? { id: cityId } : undefined,
      county: countyId ? { id: countyId } : undefined,
      postalCode: order.shippingZip || "",
    },
    // If easybox delivery, set the locker
    ...(isLocker ? { lockerId: lockerDestId } : {}),
  };

  const data = await samedayRequest(base, "/api/awb", {
    method: "POST",
    token,
    body: payload,
  });

  if (data.awbNumber) {
    return {
      success: true,
      awbNumber: String(data.awbNumber),
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

  const res = await fetch(`${base}/api/awb/${awbNumber}/download`, {
    headers: { "X-AUTH-TOKEN": token, Accept: "application/pdf" },
  });

  if (!res.ok) throw new Error(`Sameday PDF download failed: ${res.status}`);

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
