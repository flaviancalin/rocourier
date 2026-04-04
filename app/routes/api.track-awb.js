// app/routes/api.track-awb.js
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { getOrder, addTrackingEvent, updateOrderAwb } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { fanTrackAwb } from "../services/fan-courier.server.js";
import { samedayTrackAwb } from "../services/sameday.server.js";
import { cargusTrackAwb } from "../services/cargus.server.js";
import { glsTrackAwb } from "../services/gls.server.js";
import { packetaTrackPacket } from "../services/packeta.server.js";

// Map courier event codes to our unified status strings
function eventToStatus(events, courier) {
  if (!events || events.length === 0) return null;

  const latest = events[0];
  const code = String(latest.code || "").toLowerCase();
  const desc = String(latest.description || "").toLowerCase();

  if (courier === "fan") {
    if (code.includes("livrat") || code === "200" || desc.includes("livrat"))  return "delivered";
    if (code.includes("tranzit") || code === "100" || desc.includes("tranzit")) return "in_transit";
    if (code.includes("retur") || desc.includes("retur"))                       return "returned";
    if (code.includes("preluat") || desc.includes("preluat"))                   return "picked_up";
  }

  if (courier === "sameday") {
    // Sameday status codes: 1=in_depot, 4=in_transit, 6=out_for_delivery, 8=delivered, 10=return
    if (code === "8")  return "delivered";
    if (code === "6")  return "out_for_delivery";
    if (code === "4")  return "in_transit";
    if (code === "10") return "returned";
    if (code === "1")  return "picked_up";
  }

  if (courier === "cargus") {
    // Cargus event IDs: varies — map by description keywords
    if (desc.includes("livrat") || desc.includes("delivered")) return "delivered";
    if (desc.includes("retur") || desc.includes("return"))     return "returned";
    if (desc.includes("tranzit") || desc.includes("transit"))  return "in_transit";
    if (desc.includes("preluat") || desc.includes("picked"))   return "picked_up";
    if (desc.includes("livrare") || desc.includes("out for"))  return "out_for_delivery";
  }

  if (courier === "gls") {
    // GLS status codes
    if (code === "delivered" || desc.includes("livrat"))        return "delivered";
    if (code === "out_for_delivery" || desc.includes("livrare")) return "out_for_delivery";
    if (code === "in_transit" || desc.includes("tranzit"))      return "in_transit";
    if (code === "inwarehouse" || desc.includes("depozit"))     return "picked_up";
    if (code === "returned" || desc.includes("retur"))          return "returned";
  }

  if (courier === "packeta") {
    // Packeta status code texts
    if (code.includes("delivered") || desc.includes("livrat"))  return "delivered";
    if (code.includes("return") || desc.includes("retur"))      return "returned";
    if (code.includes("transit") || desc.includes("tranzit"))   return "in_transit";
    if (code.includes("out") || desc.includes("la livrare"))    return "out_for_delivery";
    if (code.includes("arrived") || desc.includes("preluat"))   return "picked_up";
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
    } else if (order.courierType === "cargus" && settings?.cargusSubscriptionKey) {
      events = await cargusTrackAwb({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
        awbNumber: order.awbNumber,
      });
    } else if (order.courierType === "gls" && settings?.glsUsername) {
      events = await glsTrackAwb({
        username: settings.glsUsername,
        password: settings.glsPassword,
        sandbox: !!settings.glsSandbox,
        awbNumber: order.awbNumber,
      });
    } else if (order.courierType === "packeta" && settings?.packetaApiKey) {
      events = await packetaTrackPacket({
        apiKey: settings.packetaApiKey,
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
