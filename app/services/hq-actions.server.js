// app/services/hq-actions.server.js
// What the Picklo team can see and do for a store from /hq. Every change goes through
// the store's own offline token (same scopes the merchant granted at install), needs
// the merchant's support-access consent, and is written to the store's activity log.
import { prisma } from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import { logActivity } from "./activity.server.js";
import { setupCheckout, resyncManualRatesIfNeeded } from "./checkout-setup.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { refreshOrderTracking, hasTrackingCredentials, TERMINAL_STATUSES } from "./tracking.server.js";
import { syncCodGuard } from "./cod-guard.server.js";
import { themeStatus } from "./theme.server.js";
import { syncOrdersForShop } from "./order-sync.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

const SECRET_FIELDS = ["fanPassword", "fanToken", "samedayPassword", "samedayToken", "cargusPassword", "glsPassword", "packetaApiKey",
  "smartbillToken", "oblioSecret", "fgoPrivateKey", "dpdPassword", "xconnectorApiKey"];

// Settings the team may change from /hq (no credentials: those stay with the merchant)
export const EDITABLE = {
  booleans: ["fanEnabled", "samedayEnabled", "cargusEnabled", "glsEnabled", "packetaEnabled", "dpdEnabled", "samedaySandbox", "glsSandbox", "fgoSandbox",
    "autoGenerateAwb", "autoAwbMarkShipped", "autoAwbNotifyCustomer", "autoSendInvoice", "autoInvoiceOnFulfill", "autoInvoiceOnDelivered",
    "onCancelDeleteAwb", "onRefundReverseInvoice", "onDeliveredMarkPaid", "onReturnedCancelOrder", "statusTags", "copyCustomerPhone",
    "showPickupMap", "showDeliveryEstimate", "validateAddresses", "returnsEnabled", "onboardingCompleted"],
  numbers: ["defaultWeight", "checkoutLockerCount", "dispatchCutoffHour", "processingDays", "refusalWarnThreshold", "blockCodAfterRefusals",
    "returnsWindowDays", "freeShippingThreshold", ...Object.keys(COURIER_LABELS).flatMap((c) => [`${c}HomeDeliveryFee`, `${c}PickupFee`])],
  strings: ["defaultCourier", "widgetLanguage", "invoiceProvider", "autoAwbFilter", "onCancelInvoice", "onReturnedInvoice", "freeShippingScope",
    "returnsCourier", "dpdServiceId", "dpdLabelSize", "packetaLabelFormat", "senderName", "senderPhone", "senderEmail", "senderAddress",
    "senderCity", "senderCounty", "senderZip", "smartbillSeries", "oblioSeries", "fgoSeries"],
};

export const safeSettings = (s) => {
  if (!s) return null;
  const out = { ...s };
  for (const f of SECRET_FIELDS) out[f] = s[f] ? "••••" : null;
  return out;
};

// ── Lists ────────────────────────────────────────────────────────────────────
export async function listShops({ search = "" } = {}) {
  const [settings, sessions, openTickets, orderCounts] = await Promise.all([
    prisma.shopSettings.findMany({
      where: search ? { shop: { contains: search, mode: "insensitive" } } : {},
      select: { shop: true, planType: true, awbCount: true, checkoutMode: true, onboardingCompleted: true, supportAccess: true, createdAt: true,
        ...Object.fromEntries(Object.keys(COURIER_LABELS).map((c) => [`${c}Enabled`, true])) },
      orderBy: { createdAt: "desc" }, take: 500,
    }),
    prisma.session.findMany({ where: { isOnline: false }, select: { shop: true } }),
    prisma.supportTicket.groupBy({ by: ["shop"], where: { status: { not: "resolved" } }, _count: true }),
    prisma.order.groupBy({ by: ["shop"], where: { createdAt: { gte: new Date(Date.now() - 30 * 864e5) } }, _count: true }),
  ]);
  const installed = new Set(sessions.map((s) => s.shop));
  const tickets = Object.fromEntries(openTickets.map((t) => [t.shop, t._count]));
  const orders = Object.fromEntries(orderCounts.map((o) => [o.shop, o._count]));
  return settings.map((s) => ({
    shop: s.shop, plan: s.planType, awbCount: s.awbCount, checkoutMode: s.checkoutMode, onboardingCompleted: s.onboardingCompleted,
    supportAccess: s.supportAccess, installed: installed.has(s.shop), createdAt: s.createdAt,
    couriers: Object.keys(COURIER_LABELS).filter((c) => s[`${c}Enabled`]),
    openTickets: tickets[s.shop] || 0, orders30: orders[s.shop] || 0,
  }));
}

export async function shopOverview(shop) {
  const [settings, session, statusCounts, recentOrders, activity, tickets, errors] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.session.findFirst({ where: { shop, isOnline: false }, select: { scope: true } }),
    prisma.order.groupBy({ by: ["awbStatus"], where: { shop }, _count: true }),
    prisma.order.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 15,
      select: { id: true, shopifyOrderName: true, customerName: true, courierType: true, shippingMethod: true, awbNumber: true, awbStatus: true, codAmount: true, createdAt: true, invoiceNumber: true, invoiceSeries: true } }),
    prisma.activityLog.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.supportTicket.findMany({ where: { shop }, orderBy: { lastMessageAt: "desc" }, take: 10 }),
    prisma.activityLog.findMany({ where: { shop, action: { in: ["auto_awb_skipped"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  if (!settings) return null;
  return {
    shop, settings: safeSettings(settings), installed: !!session, scopes: session?.scope?.split(",") || [],
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.awbStatus, s._count])),
    recentOrders, activity, tickets, recentSkips: errors,
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────
export const ACTIONS = {
  "theme-status": "Verifică widgetul din temă",
  "setup-checkout": "Refă configurarea checkout-ului",
  "resync-rates": "Resincronizează tarifele fixe",
  "sync-orders": "Sincronizează comenzile din Shopify (60 zile)",
  "refresh-tracking": "Actualizează tracking-ul acum",
  "refresh-points": "Reîmprospătează punctele de ridicare (toți curierii)",
  "cod-guard": "Recalculează lista „fără ramburs”",
  "set-plan": "Schimbă planul",
  "update-settings": "Salvează setările",
};

async function adminFor(shop) {
  return (await unauthenticated.admin(shop)).admin;
}

function parseSettingsForm(form) {
  const data = {};
  for (const k of EDITABLE.booleans) if (form.has(k)) data[k] = form.get(k) === "true";
  for (const k of EDITABLE.numbers) {
    if (!form.has(k)) continue;
    const v = String(form.get(k)).trim();
    if (v === "") { if (k === "freeShippingThreshold") data[k] = null; continue; }
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Valoare invalidă pentru ${k}`);
    data[k] = ["checkoutLockerCount", "dispatchCutoffHour", "processingDays", "refusalWarnThreshold", "blockCodAfterRefusals", "returnsWindowDays"].includes(k) ? Math.round(n) : n;
  }
  for (const k of EDITABLE.strings) if (form.has(k)) data[k] = String(form.get(k)).trim() || null;
  return data;
}

export async function runAction(shop, action, member, form) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) throw new Error("Magazinul nu există în Picklo.");
  if (!settings.supportAccess) throw new Error("Merchantul a oprit accesul echipei de suport (Picklo → Ajutor). Cere-i să îl pornească.");
  const actor = `suport:${member.email}`;
  const log = (message) => logActivity({ shop, action: `support_${action}`, actor, message });

  switch (action) {
    case "theme-status": {
      return { themes: await themeStatus(await adminFor(shop), shop) };
    }
    case "setup-checkout": {
      const r = await setupCheckout(await adminFor(shop), shop);
      await log(`Suport: checkout reconfigurat (${r.mode}${r.zones?.length ? `, zone: ${r.zones.join(", ")}` : ""})`);
      return { message: `Checkout configurat în modul ${r.mode}.`, result: r };
    }
    case "resync-rates": {
      const r = await resyncManualRatesIfNeeded(await adminFor(shop), shop);
      await log("Suport: tarife fixe resincronizate");
      return { message: r ? `Tarife actualizate în ${r.zones.length} zone.` : "Magazinul folosește tarife calculate (CCS) — nimic de resincronizat." };
    }
    case "sync-orders": {
      const r = await syncOrdersForShop(await adminFor(shop), shop);
      if (r.error) throw new Error(r.error);
      await log(`Suport: ${r.synced} comenzi sincronizate din Shopify`);
      return { message: `${r.synced} comenzi sincronizate.` };
    }
    case "refresh-tracking": {
      const orders = await prisma.order.findMany({ where: { shop, awbNumber: { not: null }, awbStatus: { notIn: ["pending", ...TERMINAL_STATUSES] } }, take: 50 });
      let changed = 0, errors = 0;
      for (const o of orders) {
        if (!hasTrackingCredentials(o.courierType, settings)) continue;
        try { if ((await refreshOrderTracking(o, settings, { actor })).changed) changed++; } catch { errors++; }
      }
      return { message: `${orders.length} colete verificate, ${changed} cu status nou${errors ? `, ${errors} erori` : ""}.` };
    }
    case "refresh-points": {
      const r = await refreshPickupPointsCache();
      return { message: Object.entries(r).filter(([k]) => k !== "errors").map(([k, v]) => `${k}: ${v}`).join(" · ") + (r.errors?.length ? ` · erori: ${r.errors.join("; ")}` : "") };
    }
    case "cod-guard": {
      const r = await syncCodGuard(shop);
      await log(`Suport: lista „fără ramburs” recalculată (${r.blocked} clienți)`);
      return { message: `${r.blocked} clienți fără ramburs.${r.customization?.error ? ` Atenție: ${r.customization.error}` : ""}` };
    }
    case "set-plan": {
      const plan = String(form.get("plan"));
      if (!["trial", "lifetime"].includes(plan)) throw new Error("Din HQ se poate seta doar trial sau lifetime (abonamentele plătite trec prin Shopify Billing).");
      await prisma.shopSettings.update({ where: { shop }, data: { planType: plan, ...(plan === "trial" ? { shopifyChargeId: null } : {}), planActivatedAt: new Date() } });
      await log(`Suport: plan schimbat în ${plan}`);
      return { message: `Plan setat: ${plan}.` };
    }
    case "update-settings": {
      const data = parseSettingsForm(form);
      const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(settings[k]));
      if (!changed.length) return { message: "Nicio modificare." };
      await prisma.shopSettings.update({ where: { shop }, data: Object.fromEntries(changed.map((k) => [k, data[k]])) });
      await log(`Suport: setări modificate — ${changed.map((k) => `${k}: ${JSON.stringify(settings[k])} → ${JSON.stringify(data[k])}`).join(", ")}`.slice(0, 990));
      // Prices in checkout follow the dashboard without CCS
      if (changed.some((k) => /Fee$|Enabled$|freeShipping/.test(k))) await resyncManualRatesIfNeeded(await adminFor(shop), shop).catch(() => {});
      return { message: `${changed.length} setări salvate.` };
    }
    default:
      throw new Error("Acțiune necunoscută.");
  }
}
