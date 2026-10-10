// app/services/order-checks.server.js
// Problems worth fixing before an AWB is generated, the customer's refusal history,
// and the merchant's courier routing rules.
import { prisma } from "../db.server.js";
import { normalizeRoPhone, isValidRoZip, parseRoStreet, normalizeName } from "../utils/address.js";

const isRomania = (country) => !country || /^(ro|romania|românia)$/i.test(String(country).trim());

// → [{ code, message }] — empty when the order looks fine. Pure: no I/O.
export function checkOrderData(order) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const ro = isRomania(order.shippingCountry);

  if (!order.customerName || String(order.customerName).trim().length < 3) add("name", "Numele destinatarului lipsește sau e prea scurt");
  if (!order.customerPhone) add("phone_missing", "Lipsește telefonul (curierii și lockerele au nevoie de el)");
  else if (ro && !normalizeRoPhone(order.customerPhone)) add("phone_invalid", `Telefon invalid pentru România: ${order.customerPhone}`);

  if (order.shippingMethod === "pickup_point") {
    if (!order.pickupPointId) add("locker_missing", "Clientul a ales livrare la locker, dar nu a selectat lockerul");
  } else {
    if (!order.shippingAddress1 || String(order.shippingAddress1).trim().length < 5) add("address_missing", "Adresa de livrare lipsește sau e incompletă");
    else if (ro) {
      const st = parseRoStreet(order.shippingAddress1);
      if (!st.streetNo && !st.blockNo && !/\d/.test(order.shippingAddress1)) add("address_no_number", "Adresa nu are număr (stradă sau bloc)");
    }
    if (!order.shippingCity) add("city_missing", "Lipsește localitatea");
    if (ro) {
      if (!order.shippingZip) add("zip_missing", "Lipsește codul poștal");
      else if (!isValidRoZip(order.shippingZip)) add("zip_invalid", `Cod poștal invalid: ${order.shippingZip} (trebuie 6 cifre)`);
      else if (/^0/.test(order.shippingZip) && order.shippingCounty && !/bucure|ilfov|bucharest/i.test(normalizeName(order.shippingCounty))) {
        // Codes starting with 0 belong to Bucharest
        add("zip_county", `Codul poștal ${order.shippingZip} e din București, dar județul este ${order.shippingCounty}`);
      }
    }
  }
  return issues;
}

// Orders of the same customer (phone or email) that came back: refused, returned, failed.
export async function refusalHistory(shop, order) {
  const phone = normalizeRoPhone(order.customerPhone);
  const email = order.customerEmail ? String(order.customerEmail).trim().toLowerCase() : null;
  if (!phone && !email) return { count: 0, orders: [] };

  const phoneVariants = phone ? [phone, `+4${phone}`, `4${phone}`, `0040${phone.slice(1)}`, `+40 ${phone.slice(1)}`] : [];
  const rows = await prisma.order.findMany({
    where: {
      shop,
      id: { not: order.id },
      awbStatus: { in: ["returned", "failed"] },
      OR: [
        ...(phoneVariants.length ? [{ customerPhone: { in: phoneVariants } }] : []),
        ...(email ? [{ customerEmail: { equals: email, mode: "insensitive" } }] : []),
      ],
    },
    select: { id: true, shopifyOrderName: true, awbStatus: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return { count: rows.length, orders: rows };
}

// Issues + refusal warning for one order, honoring the shop's settings.
export async function orderWarnings(shop, order, settings) {
  const issues = settings?.validateAddresses === false ? [] : checkOrderData(order);
  const threshold = settings?.refusalWarnThreshold ?? 1;
  if (threshold > 0) {
    const history = await refusalHistory(shop, order);
    if (history.count >= threshold) {
      issues.push({
        code: "refusals",
        message: `Clientul are ${history.count} ${history.count === 1 ? "colet refuzat/returnat" : "colete refuzate/returnate"}: ${history.orders.map((o) => o.shopifyOrderName).join(", ")}`,
      });
    }
  }
  return issues;
}

// Batch version for the order list: one query for all refusal histories.
export async function warningsForOrders(shop, orders, settings) {
  const result = {};
  const threshold = settings?.refusalWarnThreshold ?? 1;
  let returned = [];
  if (threshold > 0) {
    const phones = [...new Set(orders.map((o) => normalizeRoPhone(o.customerPhone)).filter(Boolean))];
    const emails = [...new Set(orders.map((o) => o.customerEmail?.toLowerCase()).filter(Boolean))];
    if (phones.length || emails.length) {
      returned = await prisma.order.findMany({
        where: {
          shop, awbStatus: { in: ["returned", "failed"] },
          OR: [
            ...(phones.length ? [{ customerPhone: { in: phones.flatMap((p) => [p, `+4${p}`, `4${p}`]) } }] : []),
            ...(emails.length ? [{ customerEmail: { in: emails, mode: "insensitive" } }] : []),
          ],
        },
        select: { id: true, customerPhone: true, customerEmail: true, shopifyOrderName: true },
      });
    }
  }
  for (const o of orders) {
    const issues = settings?.validateAddresses === false ? [] : checkOrderData(o);
    if (threshold > 0) {
      const phone = normalizeRoPhone(o.customerPhone);
      const email = o.customerEmail?.toLowerCase();
      const hits = returned.filter((r) => r.id !== o.id &&
        ((phone && normalizeRoPhone(r.customerPhone) === phone) || (email && r.customerEmail?.toLowerCase() === email)));
      if (hits.length >= threshold) issues.push({ code: "refusals", message: `Clientul are ${hits.length} ${hits.length === 1 ? "colet refuzat/returnat" : "colete refuzate/returnate"}: ${hits.map((h) => h.shopifyOrderName).join(", ")}` });
    }
    if (issues.length) result[o.id] = issues;
  }
  return result;
}

// ── Routing rules ────────────────────────────────────────────────────────────
// rules: [{ field: county|city|weight_over|total_over|cod|pickup, value, courier }]
export function ruleMatches(rule, order) {
  const list = (v) => String(v || "").split(",").map((x) => normalizeName(x)).filter(Boolean);
  switch (rule.field || "county") {
    case "county": return list(rule.value).includes(normalizeName(order.shippingCounty));
    case "city": return list(rule.value).includes(normalizeName(order.shippingCity));
    case "weight_over": return Number(order.weight) > Number(rule.value);
    case "total_over": return Number(order.orderTotal) > Number(rule.value);
    case "cod": return Number(order.codAmount) > 0;
    case "pickup": return order.shippingMethod === "pickup_point";
    default: return false;
  }
}

// Courier from the first matching rule whose courier is enabled, else null.
// Pickup orders keep the courier of the chosen locker — a locker belongs to one network.
export function courierFromRules(settings, order) {
  const rules = Array.isArray(settings?.routingRules) ? settings.routingRules : [];
  for (const rule of rules) {
    if (!rule?.courier || !settings[`${rule.courier}Enabled`]) continue;
    if (order.shippingMethod === "pickup_point" && order.pickupPointId && rule.courier !== order.courierType) continue;
    if (ruleMatches(rule, order)) return rule.courier;
  }
  return null;
}
