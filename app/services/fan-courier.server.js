// app/services/fan-courier.server.js
// FAN Courier API v2.0 – selfawb.ro / api.fancourier.ro
// Docs: fancourier.ro/wp-content/uploads/2025/09/EN_FANCourier_API_130825-1.pdf
// Contact for contract: sales.bucuresti@fancourier.ro
// Contact for API access: selfawb@fancourier.ro
// Sandbox (public test): clientId=7032158, user=clienttest, pass=testing

const FAN_BASE = process.env.FAN_API_BASE || "https://api.fancourier.ro";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Normalize Romanian phone to 10-digit local format (0XXXXXXXXX)
// FAN API does not accept +40 international prefix or spaces
function normalizePhone(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, ""); // strip all non-digits
  if (digits.startsWith("40") && digits.length === 11) return "0" + digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) return digits;
  return digits; // return as-is if format unknown
}

// Normalize county name: FAN expects Title Case (e.g. "Dolj", not "DOLJ" or "dolj")
function normalizeCounty(county) {
  if (!county) return "Bucuresti";
  // Map Shopify English names to Romanian
  const map = { "Bucharest": "Bucuresti", "Ilfov": "Ilfov" };
  const mapped = map[county] || county;
  // Title case: first letter upper, rest lower — handles "DOLJ" → "Dolj"
  return mapped.charAt(0).toUpperCase() + mapped.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Token cache (per clientId, in-process; for multi-instance use Redis)
// ─────────────────────────────────────────────────────────────────────────────
const tokenCache = new Map(); // clientId → { token, expiresAt }

function getCachedToken(clientId) {
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  return null;
}

function setCachedToken(clientId, token, ttlSeconds = 3600) {
  tokenCache.set(clientId, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core helper
// ─────────────────────────────────────────────────────────────────────────────
async function fanRequest(path, { method = "GET", token, body, clientId, _retry = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${FAN_BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  // On 401, clear stale cached token and retry once with a fresh one
  if (res.status === 401 && clientId && !_retry) {
    tokenCache.delete(clientId);
    return fanRequest(path, { method, body, clientId, _retry: true });
  }

  if (!res.ok) {
    throw new Error(`FAN Courier API error [${res.status}] ${path}: ${text}`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth – Basic Auth returns a JWT
// POST /login  body: { client_id, username, password }
// ─────────────────────────────────────────────────────────────────────────────
export async function fanAuthenticate({ clientId, username, password }) {
  const cached = getCachedToken(clientId);
  if (cached) return cached;

  const data = await fanRequest("/login", {
    method: "POST",
    body: { client_id: clientId, username, password },
  });

  if (!data.data?.token) {
    throw new Error(`FAN Auth failed: ${JSON.stringify(data)}`);
  }

  const token = data.data.token;
  setCachedToken(clientId, token, 3500); // tokens last ~1h
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUDO / FANbox pickup points
// GET /reports/pickup-points?type=fanbox&perPage=1000
// Returns paginated list of { id, name, address, locality, county, lat, lng }
// ─────────────────────────────────────────────────────────────────────────────
export async function fanGetPickupPoints({ clientId, username, password }) {
  const token = await fanAuthenticate({ clientId, username, password });

  // FAN's API ignores currentPage and returns all records in a single response.
  // Paginating causes the same data to be fetched multiple times.
  // Single call with a high perPage is sufficient.
  const data = await fanRequest(
    "/reports/pickup-points?type=fanbox&perPage=5000&currentPage=1",
    { token }
  );

  const points = data.data || [];
  if (points.length > 0) {
    console.error("[FAN] pickup-points first raw point keys:", JSON.stringify(Object.keys(points[0])));
    console.error("[FAN] pickup-points first raw point:", JSON.stringify(points[0]));
  }
  console.error(`[FAN] pickup-points fetched: ${points.length}`);

  return points.map((p) => {
    const addr = p.address || {};
    const street = [addr.street, addr.streetNo].filter(Boolean).join(" ");
    const city   = addr.locality || addr.city || p.locality || p.city || "";
    // FAN API uses different field names across versions — try all known ones
    const county = addr.county || addr.district || addr.judCode || addr.jud ||
                   p.county || p.district || p.judCode || p.jud || "";
    const zip    = addr.zipCode  || addr.zip || p.zipCode || p.zip || "";

    // p.code (e.g. "FAN0039") is what /intern-awb expects as pickupLocationId.
    // p.id (e.g. "F1000005") is FAN's internal identifier — NOT accepted by the AWB API.
    const externalId = p.code || String(p.id || "");

    return {
      id:         externalId,
      externalId,
      courier:    "fan",
      type:       "fanbox",
      name:       p.name || "FANbox",
      address:    [street, city, county].filter(Boolean).join(", "),
      city,
      county,
      zip:        zip || null,
      lat:        parseFloat(p.latitude)  || null,
      lng:        parseFloat(p.longitude) || null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get available services for your contract
// GET /services
// ─────────────────────────────────────────────────────────────────────────────
export async function fanGetServices({ clientId, username, password }) {
  const token = await fanAuthenticate({ clientId, username, password });
  const data = await fanRequest("/services", { token });
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculate shipping price
// POST /price
// ─────────────────────────────────────────────────────────────────────────────
export async function fanCalculatePrice({ clientId, username, password, params }) {
  const token = await fanAuthenticate({ clientId, username, password });
  const data = await fanRequest("/price", {
    method: "POST",
    token,
    body: {
      clientId,
      modality: params.service || "Standard",
      recipient: {
        judCode: params.recipientCounty,
        locCode: params.recipientCity,
      },
      packages: {
        weight: params.weight || 1,
        type: 1, // colete
        number: params.packageCount || 1,
      },
      payment: "destinatar",
      cod: params.codAmount || 0,
    },
  });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate AWB
// POST /intern-awb
// ─────────────────────────────────────────────────────────────────────────────
export async function fanCreateAwb({
  clientId, username, password,
  order,      // { customerName, customerPhone, shippingAddress1, shippingCity, shippingCounty, shippingZip, codAmount, notes, weight, packageCount }
  settings,   // { senderName, senderPhone, senderCity, senderZip, senderAddress, senderCounty }
  pickupPointId = null,        // if set → FANbox delivery
  serviceOverride = null,      // e.g. "Standard", "FANbox", "RedCode", "Export", "Produse Albe"
  observations = null,         // optional observations text
  openPackage = false,         // allow recipient to inspect before accepting (not supported on FANbox)
  shipmentPayer = "recipient", // "sender" or "recipient" — who pays shipping cost
  declaredValue = 0,           // declared goods value (RON)
  saturdayDelivery = false,    // Saturday delivery — adds "S" to options
}) {
  const token = await fanAuthenticate({ clientId, username, password });

  // Validate required fields before hitting FAN API
  if (!order.customerName || order.customerName === "Unknown") {
    throw new Error("FAN AWB: recipient name is missing. Re-sync the order from Shopify first.");
  }
  if (!order.customerPhone) {
    throw new Error("FAN AWB: recipient phone is missing.");
  }
  if (!settings.senderName || !settings.senderCity || !settings.senderAddress) {
    throw new Error("FAN AWB: sender details not configured. Fill in Settings → FAN Courier sender info.");
  }

  // If pickup point id is invalid/null, fall back to home delivery
  const effectivePickupId = pickupPointId && pickupPointId !== "null" ? pickupPointId : null;
  const isLocker = !!effectivePickupId;
  const hasCod   = (order.codAmount || 0) > 0;

  // FANbox locker delivery uses "FANbox" or "FANbox Cont Collector" (with COD).
  // "Cont Collector" (ID 4) is account-based payment on regular home delivery — completely different.
  // Auto-upgrade "FANbox" → "FANbox Cont Collector" when COD is present.
  let service;
  if (serviceOverride === "FANbox" && hasCod) {
    service = "FANbox Cont Collector";
  } else if (serviceOverride) {
    service = serviceOverride;
  } else if (isLocker) {
    service = hasCod ? "FANbox Cont Collector" : "FANbox";
  } else {
    service = "Standard";
  }

  const isLockerService    = service === "FANbox" || service === "FANbox Cont Collector";
  const isLockerWithCod    = service === "FANbox Cont Collector";

  // Options per FAN API docs:
  //   "V" = simple FANbox locker pickup (no COD)
  //   "Y" = mPOS card payment at FANbox locker (COD via card — required for FANbox Cont Collector)
  //   "S" = Saturday delivery
  const optionLetters = [
    ...(isLockerWithCod  ? ["Y"] : isLockerService ? ["V"] : []),
    ...(saturdayDelivery ? ["S"] : []),
  ].join("");

  const payload = {
    clientId,
    shipments: [
      {
        info: {
          service,
          packages: {
            parcel:   order.packageCount || 1,
            envelope: 0,
          },
          weight:        order.weight || 1,
          cod:           order.codAmount || 0,
          declaredValue: declaredValue || 0,
          // Locker services (FANbox / FANbox Cont Collector): sender always pre-pays shipping.
          // "recipient" payment is invalid for lockers — recipient can only pay goods via mPOS (option Y).
          payment:       isLockerService ? "sender" : (shipmentPayer === "sender" ? "sender" : "recipient"),
          // returnPayment only for home delivery with COD — locker services don't use it
          ...(!isLockerService ? { returnPayment: "sender" } : {}),
          content:       "Colet",
          observation:   observations || order.notes || "",
          // FAN API requires openPackage to be explicit: 0 for lockers, 0 or 1 for home delivery
          openPackage: isLockerService ? 0 : (openPackage ? 1 : 0),
          dimensions:    { width: 20, height: 15, length: 30 },
          // options: "V" = FANbox locker pickup, "S" = Saturday delivery
          ...(optionLetters ? { options: optionLetters } : {}),
        },
        // ── Recipient ──────────────────────────────────────────────────
        recipient: {
          name:  order.customerName,
          phone: normalizePhone(order.customerPhone),
          // FAN API docs don't include email in the recipient object; omit empty strings
          // to avoid unexpected field rejection
          ...(order.customerEmail ? { email: order.customerEmail } : {}),
          address: isLockerService
            ? {
                // FANbox: county+locality must come from the locker's own data (not the customer's address).
                // generate-awb.js sets shippingCity/shippingCounty from the lockerPoint DB record.
                county:           normalizeCounty(order.shippingCounty || "Bucuresti"),
                locality:         order.shippingCity || "Bucuresti",
                pickupLocationId: String(effectivePickupId),
              }
            : {
                county:   normalizeCounty(order.shippingCounty),
                locality: order.shippingCity || "Bucuresti",
                street:   order.shippingAddress1 || "",
                zipCode:  order.shippingZip || "",
              },
        },
        // ── Sender ─────────────────────────────────────────────────────
        sender: {
          name:  settings.senderName,
          phone: normalizePhone(settings.senderPhone),
          address: {
            county:   normalizeCounty(settings.senderCounty),
            locality: settings.senderCity,
            zipCode:  settings.senderZip || "",
            street:   settings.senderAddress,
          },
        },
      },
    ],
  };

  if (isLockerService) {
    console.error(`[FAN] FANbox pickupLocationId="${effectivePickupId}" service="${service}" payment="${payload.shipments[0].info.payment}" options="${payload.shipments[0].info.options || ""}"`);
  }
  console.error("[FAN] intern-awb payload:", JSON.stringify(payload));
  const data = await fanRequest("/intern-awb", { method: "POST", token, body: payload, clientId });
  console.error("[FAN] intern-awb response:", JSON.stringify(data));

  // FAN returns { response: [{ awbNumber, success, errors }] }
  const firstResult = data.response?.[0] || data.data?.[0];
  const awbNumber = firstResult?.awbNumber || firstResult?.awb;

  if (awbNumber) {
    return {
      success: true,
      awbNumber: String(awbNumber),
      raw: data,
    };
  }

  // Extract structured validation errors from FAN's response
  const errors = firstResult?.errors;
  if (errors && typeof errors === "object") {
    const msg = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : msgs}`)
      .join("; ");
    throw new Error(`FAN AWB: ${msg}`);
  }
  // errors is sometimes a plain string ("An error occurred" = generic FAN rejection)
  const errStr = typeof errors === "string" ? errors : null;
  const fanError = firstResult?.message || errStr || data.message || data.error || JSON.stringify(data);
  const lockerCtx = isLockerService ? ` [locker: "${effectivePickupId}", service: "${service}"]` : "";
  throw new Error(`FAN AWB generation failed${lockerCtx}: ${fanError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Download AWB label PDF
// GET /awb/label?clientId=...&awbs[]=...&pdf=1
// Returns binary PDF buffer
// ─────────────────────────────────────────────────────────────────────────────
export async function fanPrintAwb({ clientId, username, password, awbNumber }) {
  const token = await fanAuthenticate({ clientId, username, password });

  const url = `${FAN_BASE}/awb/label?clientId=${encodeURIComponent(clientId)}&awbs[]=${encodeURIComponent(awbNumber)}&pdf=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/pdf, */*",
    },
  });

  console.error(`[FAN] awb/label [${res.status}] content-type: ${res.headers.get("content-type")}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAN label download failed [${res.status}]: ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Track AWB – returns list of events
// GET /awb-events?awb=XXXXX
// ─────────────────────────────────────────────────────────────────────────────
export async function fanTrackAwb({ clientId, username, password, awbNumber }) {
  const token = await fanAuthenticate({ clientId, username, password });
  const data = await fanRequest(`/awb-events?awb=${awbNumber}`, { token });

  const events = data.data || [];
  return events.map((e) => ({
    code: e.eventCode || e.cod,
    description: e.eventDescription || e.descriere || e.description,
    date: new Date(e.date || e.data),
    location: e.location || e.localitate || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete AWB (before courier pickup only)
// DELETE /intern-awb?awb=XXXXX
// ─────────────────────────────────────────────────────────────────────────────
export async function fanDeleteAwb({ clientId, username, password, awbNumber }) {
  const token = await fanAuthenticate({ clientId, username, password });
  return fanRequest(`/intern-awb?awb=${awbNumber}`, { method: "DELETE", token });
}
