// app/services/returns.server.js
// Customer returns: the customer files a request from the store (app proxy form),
// the merchant approves it in Picklo, and Picklo creates the return AWB that picks
// the parcel up from the customer and brings it back to the merchant.
import { prisma } from "../db.server.js";
import { logActivity } from "./activity.server.js";
import { fanCreateAwb } from "./fan-courier.server.js";
import { glsCreateAwb, glsStoreRef } from "./gls.server.js";
import { cargusCreateAwb, cargusGetSenderLocations } from "./cargus.server.js";
import { dpdCreateReturnAwb } from "./dpd.server.js";
import { packetaCreateReturn, packetaCredentials } from "./packeta.server.js";
import { flowReturnRequested } from "./flow.server.js";

import { RETURN_COURIERS } from "../utils/returns.js";
export { RETURN_COURIERS };

export const RETURN_REASONS = [
  "Nu mi se potrivește mărimea",
  "Produsul nu corespunde descrierii",
  "Produs deteriorat sau defect",
  "Am primit alt produs",
  "M-am răzgândit",
  "Altul",
];

const DAY = 864e5;
const normalizeOrderName = (s) => `#${String(s || "").trim().replace(/^#/, "")}`;

// Finds the order the customer refers to; email or phone must match it.
export async function findReturnableOrder(shop, { orderName, contact }) {
  const order = await prisma.order.findFirst({ where: { shop, shopifyOrderName: normalizeOrderName(orderName) } });
  if (!order) return { error: "Nu am găsit comanda. Verifică numărul comenzii." };
  const c = String(contact || "").trim().toLowerCase();
  const digits = (x) => String(x || "").replace(/\D/g, "").slice(-9);
  const emailOk = c.includes("@") && order.customerEmail?.toLowerCase() === c;
  const phoneOk = !c.includes("@") && digits(c).length === 9 && digits(order.customerPhone) === digits(c);
  if (!emailOk && !phoneOk) return { error: "Emailul sau telefonul nu corespund comenzii." };
  return { order };
}

export async function canReturn(shop, order, settings) {
  if (!settings?.returnsEnabled) return "Retururile online nu sunt activate pentru acest magazin.";
  if (order.shopifyCancelledAt) return "Comanda a fost anulată.";
  const since = order.deliveredAt || order.updatedAt || order.createdAt;
  const days = settings.returnsWindowDays ?? 14;
  if (order.awbStatus === "delivered" && Date.now() - new Date(since).getTime() > days * DAY) {
    return `Termenul de retur de ${days} zile de la livrare a expirat.`;
  }
  if (!["delivered", "out_for_delivery", "in_transit", "picked_up", "generated"].includes(order.awbStatus)) {
    return "Comanda nu a fost încă expediată.";
  }
  const open = await prisma.returnRequest.findFirst({ where: { shop, orderId: order.id, status: { in: ["requested", "approved", "awb_generated"] } } });
  if (open) return "Există deja o cerere de retur deschisă pentru această comandă.";
  return null;
}

export async function createReturnRequest(shop, order, input) {
  const items = (input.items || []).filter((i) => i.name && Number(i.quantity) > 0);
  if (!items.length) throw new Error("Alege cel puțin un produs de returnat.");
  if (!input.reason) throw new Error("Alege motivul returului.");
  const iban = input.iban ? String(input.iban).replace(/\s/g, "").toUpperCase() : null;
  if (iban && !/^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(iban)) throw new Error("IBAN-ul nu pare valid (format RO + 22 caractere).");

  const rr = await prisma.returnRequest.create({
    data: {
      shop, orderId: order.id, shopifyOrderName: order.shopifyOrderName,
      customerName: order.customerName, customerEmail: order.customerEmail, customerPhone: order.customerPhone,
      items, reason: String(input.reason).slice(0, 200), comment: input.comment ? String(input.comment).slice(0, 1000) : null,
      method: "courier", iban,
    },
  });
  await logActivity({ shop, order, action: "return_requested", actor: "customer", message: `Cerere de retur: ${rr.reason} (${items.length} produs(e))` });
  flowReturnRequested(shop, order, rr.reason);
  return rr;
}

// Return AWB: picked up from the customer's delivery address, delivered to the merchant.
export async function generateReturnAwb(shop, returnId, { actor = "staff" } = {}) {
  const rr = await prisma.returnRequest.findFirst({ where: { shop, id: returnId } });
  if (!rr) throw new Error("Cererea de retur nu există.");
  if (rr.returnAwbNumber) return { awbNumber: rr.returnAwbNumber, courier: rr.returnCourier };
  const [order, settings] = await Promise.all([
    prisma.order.findUnique({ where: { id: rr.orderId } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);
  const courier = settings.returnsCourier || order.courierType;
  if (!RETURN_COURIERS.includes(courier)) {
    throw new Error(`Retururile prin ${courier} nu sunt încă suportate automat. Alege FAN, GLS, Cargus, DPD sau Packeta la Setări → Livrare & verificări → Curier pentru retururi.`);
  }
  // A locker order has no home address on file: the customer's return is picked up from the address they gave Shopify
  const from = {
    name: order.customerName, phone: order.customerPhone, email: order.customerEmail,
    address: order.shippingAddress1, city: order.shippingCity, county: order.shippingCounty, zip: order.shippingZip,
  };
  if (courier !== "packeta" && (!from.address || !from.city)) throw new Error("Comanda nu are adresa clientului — nu știu de unde să ridic returul.");

  const merchantAsRecipient = {
    customerName: settings.senderName, customerPhone: settings.senderPhone, customerEmail: settings.senderEmail,
    shippingAddress1: settings.senderAddress, shippingCity: settings.senderCity, shippingCounty: settings.senderCounty,
    shippingZip: settings.senderZip, shippingCountry: "RO",
    codAmount: 0, weight: order.weight || 1, packageCount: 1, shopifyOrderName: `R${order.shopifyOrderName.replace("#", "")}`,
  };
  const customerAsSender = {
    senderName: from.name, senderPhone: from.phone, senderEmail: from.email,
    senderAddress: from.address, senderCity: from.city, senderCounty: from.county, senderZip: from.zip,
  };

  let result;
  if (courier === "fan") {
    result = await fanCreateAwb({
      clientId: settings.fanClientId, username: settings.fanUsername, password: settings.fanPassword,
      order: merchantAsRecipient, settings: customerAsSender, shipmentPayer: "recipient",
      observations: `Retur comanda ${order.shopifyOrderName}`,
    });
  } else if (courier === "gls") {
    result = await glsCreateAwb({
      username: settings.glsUsername, password: settings.glsPassword, sandbox: !!settings.glsSandbox,
      order: merchantAsRecipient, settings: { ...customerAsSender, glsClientNumber: settings.glsClientNumber },
      clientNumber: parseInt(settings.glsClientNumber) || 0,
    });
  } else if (courier === "cargus") {
    const locations = await cargusGetSenderLocations({ subscriptionKey: settings.cargusSubscriptionKey, username: settings.cargusUsername, password: settings.cargusPassword });
    const loc = locations[0];
    if (!loc) throw new Error("Cargus: nu există un punct de ridicare definit pe cont.");
    result = await cargusCreateAwb({
      subscriptionKey: settings.cargusSubscriptionKey, username: settings.cargusUsername, password: settings.cargusPassword,
      order: { ...merchantAsRecipient, codAmount: 0 }, senderLocationId: loc.LocationId || loc.locationId,
      returnFrom: from, shipmentPayer: 2, cashRepayment: 0, bankRepayment: 0,
      observations: `Retur comanda ${order.shopifyOrderName}`,
    });
  } else if (courier === "packeta") {
    result = await packetaCreateReturn({ apiPassword: packetaCredentials(settings).apiPassword, settings, order, sendEmail: true });
  } else if (courier === "dpd") {
    result = await dpdCreateReturnAwb({
      username: settings.dpdUsername, password: settings.dpdPassword, settings, from,
      weight: order.weight || 1, reference: order.shopifyOrderName, note: rr.reason,
    });
  }

  await prisma.returnRequest.update({
    where: { id: rr.id },
    data: { status: "awb_generated", returnCourier: courier, returnAwbNumber: result.awbNumber, dropoffPassword: result.password || null,
      returnLabelRef: courier === "gls" ? glsStoreRef(result.parcelId, result.labelBase64) : courier === "packeta" && result.packetId ? `packeta_id:${result.packetId}` : null },
  });
  await logActivity({ shop, order, action: "return_awb", actor, message: `AWB retur ${result.awbNumber} (${courier}) pentru cererea din ${rr.createdAt.toISOString().slice(0, 10)}` });
  return { awbNumber: result.awbNumber, courier };
}

export async function setReturnStatus(shop, returnId, status, { note, actor = "staff" } = {}) {
  const allowed = ["approved", "rejected", "received", "refunded"];
  if (!allowed.includes(status)) throw new Error("Status invalid");
  const rr = await prisma.returnRequest.update({
    where: { id: returnId },
    data: { status, ...(note != null ? { merchantNote: note } : {}) },
  });
  if (rr.shop !== shop) throw new Error("Not found");
  const order = await prisma.order.findUnique({ where: { id: rr.orderId } });
  const labels = { approved: "aprobată", rejected: "respinsă", received: "primit înapoi", refunded: "rambursat" };
  await logActivity({ shop, order, action: `return_${status}`, actor, message: `Retur ${labels[status]}${note ? `: ${note}` : ""}` });
  return rr;
}
