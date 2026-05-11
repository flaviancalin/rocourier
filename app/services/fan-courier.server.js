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

  // Fetch all FANbox lockers (paginated, up to 1000 per page)
  const data = await fanRequest(
    "/reports/pickup-points?type=fanbox&perPage=1000&currentPage=1",
    { token }
  );

  const points = data.data || [];

  return points.map((p) => {
    const addr = p.address || {};
    const street = [addr.street, addr.streetNo].filter(Boolean).join(" ");
    const city   = addr.locality || "";
    const county = addr.county   || "";
    const zip    = addr.zipCode  || "";

    return {
      id: String(p.id),
      externalId: String(p.id),
      courier: "fan",
      type: "fanbox",
      name: p.name || "FANbox",
      address: [street, city, county].filter(Boolean).join(", "),
      city,
      county,
      zip: zip || null,
      lat: parseFloat(p.latitude)  || null,
      lng: parseFloat(p.longitude) || null,
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
  pickupPointId = null, // if set → FANbox delivery
  serviceOverride = null, // e.g. "Standard", "Cont Colector", "RedCode", "Produse Albe"
  observations = null,    // optional observations text
  openPackage = false,    // allow recipient to inspect before accepting
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
  // serviceOverride takes priority; "Cont Colector" implies locker delivery but only when ID is present
  const service = serviceOverride === "Cont Colector" && !effectivePickupId
    ? "Standard"
    : (serviceOverride || (effectivePickupId ? "Cont Colector" : "Standard"));
  // When service is "Cont Colector" we need the pickup point; for other services ignore it
  const finalPickupId = service === "Cont Colector" ? effectivePickupId : null;

  const payload = {
    clientId,
    shipments: [
      {
        // ── Shipment info (must be nested under "info" per FAN API spec) ──
        info: {
          service,
          packages: {
            parcel:   order.packageCount || 1,
            envelope: 0,
          },
          weight:       order.weight || 1,
          cod:          order.codAmount || 0,
          declaredValue: 0,
          payment:      "recipient",
          content:      "Colet",
          observation:  observations || order.notes || "",
          openPackage:  openPackage ? 1 : 0,
          dimensions:   { width: 20, height: 15, length: 30 },
        },
        // ── Recipient ──────────────────────────────────────────────────
        recipient: {
          name:  order.customerName,
          phone: normalizePhone(order.customerPhone),
          address: finalPickupId
            ? { id: parseInt(String(finalPickupId), 10) }
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

  console.error("[FAN] intern-awb payload:", JSON.stringify(payload));
  const data = await fanRequest("/intern-awb", { method: "POST", token, body: payload, clientId });
  console.error("[FAN] intern-awb response:", JSON.stringify(data));

  // FAN sometimes returns 200 with error details nested in data[0]
  const firstResult = data.data?.[0];
  if (firstResult?.awb) {
    return {
      success: true,
      awbNumber: String(firstResult.awb),
      raw: data,
    };
  }

  // Extract the most useful error detail from FAN's response
  const fanError = firstResult?.error || firstResult?.message ||
    data.message || data.error || JSON.stringify(data);
  throw new Error(`FAN AWB generation failed: ${fanError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Print AWB (returns PDF URL or base64)
// GET /awb-pdf?awb=XXXXX
// ─────────────────────────────────────────────────────────────────────────────
export async function fanPrintAwb({ clientId, username, password, awbNumber }) {
  const token = await fanAuthenticate({ clientId, username, password });
  const data = await fanRequest(`/awb-pdf?awb=${awbNumber}`, { token });
  return data; // { pdfUrl } or { pdf: "base64..." }
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
