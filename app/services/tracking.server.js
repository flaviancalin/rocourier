// app/services/tracking.server.js
// One place for courier tracking: fetch events, turn them into a Picklo status,
// save them and run the status automations. Used by the order page ("Track")
// and by the hourly background sync, for every courier.
import { prisma } from "../db.server.js";
import { addTrackingEvent } from "../models/order.server.js";
import { fanTrackAwb } from "./fan-courier.server.js";
import { samedayTrackAwb } from "./sameday.server.js";
import { cargusTrackAwb } from "./cargus.server.js";
import { glsTrackAwb } from "./gls.server.js";
import { packetaTrackPacket, packetaCredentials } from "./packeta.server.js";
import { dpdTrackAwb } from "./dpd.server.js";
import { onShipmentStatusChanged } from "./automations.server.js";
import { logActivity } from "./activity.server.js";
import { flowStatusChanged } from "./flow.server.js";
import { syncCodGuard } from "./cod-guard.server.js";

export const TERMINAL_STATUSES = ["delivered", "returned", "failed", "cancelled"];

// Which couriers a shop has credentials for (tracking needs the merchant's account).
export function hasTrackingCredentials(courier, s) {
  switch (courier) {
    case "fan": return !!(s?.fanClientId && s.fanUsername);
    case "sameday": return !!s?.samedayUsername;
    case "cargus": return !!s?.cargusSubscriptionKey;
    case "gls": return !!s?.glsUsername;
    case "packeta": { const c = packetaCredentials(s); return !!(c.apiKey || c.apiPassword); }
    case "dpd": return !!s?.dpdUsername;
    default: return false;
  }
}

export async function fetchTrackingEvents(order, s) {
  if (!hasTrackingCredentials(order.courierType, s)) return [];
  const awbNumber = order.awbNumber;
  switch (order.courierType) {
    case "fan": return fanTrackAwb({ clientId: s.fanClientId, username: s.fanUsername, password: s.fanPassword, awbNumber });
    case "sameday": return samedayTrackAwb({ username: s.samedayUsername, password: s.samedayPassword, sandbox: !!s.samedaySandbox, awbNumber });
    case "cargus": return cargusTrackAwb({ subscriptionKey: s.cargusSubscriptionKey, username: s.cargusUsername, password: s.cargusPassword, awbNumber });
    case "gls": return glsTrackAwb({ username: s.glsUsername, password: s.glsPassword, sandbox: !!s.glsSandbox, awbNumber });
    case "packeta": return packetaTrackPacket({ ...packetaCredentials(s), awbNumber,
      packetId: order.awbPdfUrl?.startsWith("packeta_id:") ? order.awbPdfUrl.slice(11).split(":")[0] : null });
    case "dpd": return dpdTrackAwb({ username: s.dpdUsername, password: s.dpdPassword, awbNumber });
    default: return [];
  }
}

// Courier event text (RO/EN) → Picklo status. Order matters: "livrat înapoi la expeditor"
// is a return and "nelivrat" is a failure, so those are checked before "livrat".
const TEXT_RULES = [
  ["returned", /retur|returned|refuz|refused|inapoi la expeditor|back to sender/],
  ["failed", /nelivrat|ne-livrat|esuat|eșuat|failed|unsuccessful|adresa (gresita|incompleta)|destinatar absent|not delivered/],
  ["delivered", /livrat|delivered|predat destinatar|ridicat de destinatar|ridicat din (easybox|locker|fanbox)/],
  ["out_for_delivery", /in curs de livrare|în curs de livrare|la livrare|out for delivery|in livrare|depus in|disponibil pentru ridicare|ready for (pickup|collection)|in easybox|in locker|in fanbox/],
  ["in_transit", /tranzit|transit|hub|depozit|sortare|sorting|departure|arrival|plecat|sosit/],
  ["picked_up", /preluat|ridicat de curier|picked up|predat curier|collected from sender/],
];

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function statusFromEvent(event, courier) {
  if (event?.status) return event.status;                 // courier module already mapped it (DPD)
  const text = strip(`${event?.description || ""} ${courier === "packeta" || courier === "gls" ? event?.code || "" : ""}`);
  for (const [status, re] of TEXT_RULES) if (re.test(text)) return status;
  return null;
}

// Newest event that maps to a status wins.
export function statusFromEvents(events, courier) {
  const sorted = [...(events || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const e of sorted) {
    const s = statusFromEvent(e, courier);
    if (s) return s;
  }
  return null;
}

// Fetches, stores and applies tracking for one order. Returns { events, status, changed }.
export async function refreshOrderTracking(order, settings, { actor = "tracking" } = {}) {
  const events = await fetchTrackingEvents(order, settings);
  for (const ev of events) await addTrackingEvent(order.id, ev).catch(() => {});

  const status = statusFromEvents(events, order.courierType);
  const changed = !!status && status !== order.awbStatus;
  if (changed) {
    await prisma.order.update({
      where: { id: order.id },
      data: { awbStatus: status, ...(status === "delivered" && !order.deliveredAt ? { deliveredAt: new Date() } : {}) },
    });
    await logActivity({ shop: order.shop, order, action: `status_${status}`, message: `Status AWB ${order.awbNumber}: ${status}`, actor });
    flowStatusChanged(order.shop, order, status);
    if (status === "returned" && settings?.blockCodAfterRefusals > 0) {
      syncCodGuard(order.shop).catch((e) => console.error("[Tracking] cod guard sync failed:", e?.message || e?.status || e));
    }
    await onShipmentStatusChanged(settings, order, status).catch((err) =>
      console.error(`[Tracking] automations failed for ${order.shopifyOrderName}:`, err.message));
  }
  return { events, status: status || order.awbStatus, changed };
}
