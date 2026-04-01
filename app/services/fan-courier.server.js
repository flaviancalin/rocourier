// app/services/fan-courier.server.js
// FAN Courier API v2.0 – selfawb.ro / api.fancourier.ro
// Docs: fancourier.ro/wp-content/uploads/2025/09/EN_FANCourier_API_130825-1.pdf
// Contact for contract: sales.bucuresti@fancourier.ro
// Contact for API access: selfawb@fancourier.ro
// Sandbox (public test): clientId=7032158, user=clienttest, pass=testing

const FAN_BASE = process.env.FAN_API_BASE || "https://api.fancourier.ro";

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
async function fanRequest(path, { method = "GET", token, body } = {}) {
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
// GET /pudo-points?type=fanbox
// Returns array of { id, name, address, city, county, zip, lat, long }
// ─────────────────────────────────────────────────────────────────────────────
export async function fanGetPickupPoints({ clientId, username, password, type = "fanbox" }) {
  const token = await fanAuthenticate({ clientId, username, password });

  const data = await fanRequest(`/pudo-points?type=${type}`, { token });
  const points = data.data || [];

  return points.map((p) => ({
    id: String(p.id),
    externalId: String(p.id),
    courier: "fan",
    type: type,
    name: p.name || p.alias || "FANbox",
    address: [p.address, p.city, p.county].filter(Boolean).join(", "),
    city: p.city,
    county: p.county,
    zip: p.zip || p.postal_code,
    lat: parseFloat(p.lat) || null,
    lng: parseFloat(p.long || p.lng) || null,
  }));
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
  order,      // { customerName, customerPhone, shippingAddress1, shippingCity, shippingCounty, shippingZip, codAmount, notes, weight }
  settings,   // { senderName, senderPhone, senderCity, senderZip, senderAddress, senderCounty }
  pickupPointId = null, // if set → FANbox delivery
}) {
  const token = await fanAuthenticate({ clientId, username, password });

  // Determine service based on delivery type
  const service = pickupPointId ? "Cont Colector" : "Standard";

  const payload = {
    clientId,
    info: [
      {
        service,
        bank: "",
        bankAccount: "",
        returnPayment: "sender",
        parcel: order.packageCount || 1,
        envelope: 0,
        weight: order.weight || 1,
        cod: order.codAmount || 0,
        declaredValue: 0,
        payment: "destinatar",
        content: "Colet",
        observation: order.notes || "",
        openPackage: 0,
        dimensions: { width: 20, height: 15, length: 30 },
        // ── Recipient ──────────────────────────────────────────────────
        recipient: {
          name: order.customerName,
          phone: order.customerPhone,
          address: pickupPointId
            ? { id: parseInt(pickupPointId) }
            : {
                county: order.shippingCounty || "Bucuresti",
                city: order.shippingCity || "Bucuresti",
                street: order.shippingAddress1,
                zipCode: order.shippingZip,
              },
        },
        // ── Sender ─────────────────────────────────────────────────────
        sender: {
          name: settings.senderName,
          phone: settings.senderPhone,
          address: {
            county: settings.senderCounty || "Bucuresti",
            city: settings.senderCity,
            zipCode: settings.senderZip,
            street: settings.senderAddress,
          },
        },
      },
    ],
  };

  const data = await fanRequest("/intern-awb", { method: "POST", token, body: payload });

  if (data.data?.[0]?.awb) {
    return {
      success: true,
      awbNumber: String(data.data[0].awb),
      raw: data,
    };
  }

  throw new Error(`FAN AWB generation failed: ${JSON.stringify(data)}`);
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
