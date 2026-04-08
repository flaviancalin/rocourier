// app/services/cargus.server.js
// Cargus Urgent — REST API V3
// Docs: DocumentationAPIV3-2.3.2-EN.pdf
// Base URL: https://urgentcargus.azure-api.net/api
// Auth: POST /LoginUser → Bearer token (valid 24h)
// Headers: Ocp-Apim-Subscription-Key (from Azure portal — subscribe to StandardUrgentOnlineAPI)
// Contact: urgentcargus.developer.azure-api.net for API access

const CARGUS_BASE = "https://urgentcargus.azure-api.net/api";

// Token cache: subscriptionKey → { token, expiresAt }
const tokenCache = new Map();

function getCachedToken(subscriptionKey) {
  const cached = tokenCache.get(subscriptionKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  return null;
}

function setCachedToken(subscriptionKey, token, ttlSeconds = 82800) {
  // 23h TTL (tokens valid 24h)
  tokenCache.set(subscriptionKey, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core helper
// ─────────────────────────────────────────────────────────────────────────────
async function cargusRequest(path, { method = "GET", token, subscriptionKey, body } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Ocp-Apim-Subscription-Key": subscriptionKey,
    "Ocp-Apim-Trace": "true",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${CARGUS_BASE}/${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`Cargus API error [${res.status}] ${path}: ${text}`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// POST /LoginUser
// Body: { UserName, Password }
// Returns: JWT token string (plain, not JSON object)
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusAuthenticate({ subscriptionKey, username, password }) {
  const cached = getCachedToken(subscriptionKey);
  if (cached) return cached;

  const res = await fetch(`${CARGUS_BASE}/LoginUser`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": subscriptionKey,
      "Ocp-Apim-Trace": "true",
    },
    body: JSON.stringify({ UserName: username, Password: password }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Cargus auth failed [${res.status}]: ${text}`);
  }

  // API returns the token as a JSON string (with surrounding quotes)
  const token = text.replace(/^"|"$/g, "");
  if (!token || token.length < 10) {
    throw new Error(`Cargus auth: unexpected response: ${text}`);
  }

  setCachedToken(subscriptionKey, token);
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get sender's own pickup locations (YOUR warehouse/sender points)
// GET /PickupLocations/GetForClient
// Returns list of YOUR sender locations — use LocationId in AWB creation
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusGetSenderLocations({ subscriptionKey, username, password }) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });
  const data = await cargusRequest("PickupLocations/GetForClient", { token, subscriptionKey });
  return Array.isArray(data) ? data : (data?.value || data?.data || []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Ship & Go delivery PUDO points (customer delivery destinations)
// GET /Pudo  (section 7 of API docs: "PUDO_Get" operation → path "Pudo")
// These are the public Ship & Go partner pickup points for customer delivery
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusGetPickupPoints({ subscriptionKey, username, password }) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });
  const data = await cargusRequest("PudoPoints", { token, subscriptionKey });

  const points = Array.isArray(data) ? data : (data?.value || data?.data || []);
  return points.map((p) => ({
    id: String(p.Id || p.id),
    externalId: String(p.Id || p.id),
    courier: "cargus",
    type: "cargus_ship_go",
    name: p.Name || p.name || "Cargus Ship & Go",
    address: [p.StreetName || p.Address, p.StreetNo, p.City, p.County]
      .filter(Boolean).join(", "),
    city: p.City || p.LocalityName || null,
    county: p.County || p.CountyName || null,
    zip: p.PostalCode || p.CodPostal || null,
    lat: parseFloat(p.Latitude) || null,
    lng: parseFloat(p.Longitude) || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Create AWB
// POST /Awbs
// ServiceId: 34 (≤31kg standard), 35 (31-50kg), 36 (>50kg)
// ShipmentPayer: 1=sender pays, 2=recipient pays
// CashRepayment: COD amount
// For PUDO delivery: set DeliveryPudoPoint = pudo point Id
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusCreateAwb({
  subscriptionKey, username, password,
  order,      // customer order data
  settings,   // sender settings
  senderLocationId,    // YOUR pickup point LocationId (from cargusGetSenderLocations)
  pudoPointId = null,  // PUDO/Ship&Go point Id for locker delivery
}) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });

  // Select service ID by weight
  const weight = order.weight || 1;
  let serviceId = 34;
  if (weight > 50) serviceId = 36;
  else if (weight > 31) serviceId = 35;

  const isLocker = !!pudoPointId;

  const payload = {
    SenderClientId: null,
    TertiaryClientId: null,
    TertiaryLocationId: 0,
    Sender: {
      LocationId: senderLocationId || 0,
    },
    Recipient: {
      LocationId: 0,
      Name:          order.customerName   || "",
      CountyId:      0,
      CountyName:    order.shippingCounty || "",
      LocalityId:    0,
      LocalityName:  order.shippingCity   || "",
      StreetId:      0,
      StreetName:    order.shippingAddress1 || "",
      BuildingNumber: "",
      AddressText:   order.shippingAddress1 || "",
      ContactPerson: order.customerName   || "",
      PhoneNumber:   order.customerPhone  || "",
      Email:         order.customerEmail  || "",
      CodPostal:     order.shippingZip    || "",
      CountryId:     0,
    },
    Parcels:       order.packageCount || 1,
    Envelopes:     0,
    TotalWeight:   weight,
    ServiceId:     serviceId,
    DeclaredValue: 0,
    CashRepayment: order.codAmount || 0,
    BankRepayment: 0,
    OtherRepayment: "",
    OpenPackage:   false,
    PriceTableId:  0,
    ShipmentPayer: 2, // 2 = recipient pays shipping
    SaturdayDelivery: false,
    MorningDelivery:  false,
    Observations:  order.notes || "",
    PackageContent: "Colet",
    CustomString:  order.shopifyOrderName || "",
    // PUDO delivery
    ...(isLocker ? { DeliveryPudoPoint: parseInt(pudoPointId) } : {}),
  };

  const data = await cargusRequest("Awbs", {
    method: "POST",
    token,
    subscriptionKey,
    body: payload,
  });

  // Response is the barcode directly (string or number)
  const awbNumber = typeof data === "string"
    ? data.replace(/^"|"$/g, "")
    : String(data?.BarCode || data?.barCode || data || "");

  if (!awbNumber || awbNumber === "null" || awbNumber === "undefined") {
    throw new Error(`Cargus AWB generation failed: ${JSON.stringify(data)}`);
  }

  return {
    success: true,
    awbNumber,
    raw: data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Download AWB PDF
// GET /AwbDocuments?barCodes=[awbNumber]&type=PDF&format=1&printMainOnce=1
// Returns base64-encoded PDF
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusDownloadAwbPdf({ subscriptionKey, username, password, awbNumber }) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });

  const barCodes = JSON.stringify([parseInt(awbNumber) || awbNumber]);
  const data = await cargusRequest(
    `AwbDocuments?barCodes=${encodeURIComponent(barCodes)}&type=PDF&format=1&printMainOnce=1`,
    { token, subscriptionKey }
  );

  // API returns base64 PDF string
  const b64 = typeof data === "string" ? data.replace(/^"|"$/g, "") : data;
  return Buffer.from(b64, "base64");
}

// ─────────────────────────────────────────────────────────────────────────────
// Track AWB
// GET /AwbTrace/WithRedirect?barCode=[awbNumber]
// Returns tracking events with Date, Description, LocalityName
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusTrackAwb({ subscriptionKey, username, password, awbNumber }) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });

  const barCodes = JSON.stringify([parseInt(awbNumber) || awbNumber]);
  const data = await cargusRequest(
    `AwbTrace/WithRedirect?barCode=${encodeURIComponent(barCodes)}`,
    { token, subscriptionKey }
  );

  const parcels = Array.isArray(data) ? data : (data?.value || []);
  const events = [];

  for (const parcel of parcels) {
    for (const ev of parcel?.Event || parcel?.Events || []) {
      events.push({
        code: String(ev.ResponseCode || ev.Code || ev.code || ""),
        description: ev.Description || ev.description || "",
        date: new Date(ev.Date || ev.date || Date.now()),
        location: ev.LocalityName || ev.Location || null,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete AWB (before courier pickup only)
// DELETE /Awbs?barCode=XXXXX
// Returns true/false
// ─────────────────────────────────────────────────────────────────────────────
export async function cargusDeleteAwb({ subscriptionKey, username, password, awbNumber }) {
  const token = await cargusAuthenticate({ subscriptionKey, username, password });
  return cargusRequest(`Awbs?barCode=${encodeURIComponent(awbNumber)}`, {
    method: "DELETE",
    token,
    subscriptionKey,
  });
}
