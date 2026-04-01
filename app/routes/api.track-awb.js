// app/routes/api.track-awb.js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { getOrder, addTrackingEvent, updateOrderAwb } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { fanTrackAwb } from "../services/fan-courier.server.js";
import { samedayTrackAwb } from "../services/sameday.server.js";

// Map courier event codes to our unified status strings
function eventToStatus(events, courier) {
  if (!events || events.length === 0) return null;

  const latest = events[0];
  const code = String(latest.code || "").toLowerCase();

  if (courier === "fan") {
    if (code.includes("livrat") || code === "200")  return "delivered";
    if (code.includes("tranzit") || code === "100") return "in_transit";
    if (code.includes("retur"))                     return "returned";
    if (code.includes("preluat"))                   return "picked_up";
  }

  if (courier === "sameday") {
    // Sameday status codes: 1=in_depot, 4=in_transit, 6=out_for_delivery, 8=delivered, 10=return
    if (code === "8")  return "delivered";
    if (code === "6")  return "out_for_delivery";
    if (code === "4")  return "in_transit";
    if (code === "10") return "returned";
    if (code === "1")  return "picked_up";
  }

  return null;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) return json({ error: "Missing orderId" }, { status: 400 });

  const order    = await getOrder(session.shop, orderId);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });

  if (!order?.awbNumber) return json({ events: [] });

  try {
    let events = [];

    if (order.courierType === "fan" && settings?.fanClientId) {
      events = await fanTrackAwb({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
        awbNumber: order.awbNumber,
      });
    } else if (order.courierType === "sameday" && settings?.samedayUsername) {
      events = await samedayTrackAwb({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        awbNumber: order.awbNumber,
      });
    }

    // Persist events to DB
    for (const ev of events) {
      try {
        await addTrackingEvent(order.id, ev);
      } catch (e) {
        // Duplicate events — ignore
      }
    }

    // Update order status based on latest event
    const newStatus = eventToStatus(events, order.courierType);
    if (newStatus && newStatus !== order.awbStatus) {
      await updateOrderAwb(order.id, { awbNumber: order.awbNumber, awbStatus: newStatus });
    }

    return json({ events, status: newStatus || order.awbStatus });
  } catch (e) {
    console.error("Track AWB error:", e);
    return json({ events: order.events || [], error: e.message });
  }
}
