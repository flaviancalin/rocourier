// app/services/pickup-reminders.server.js — email reminders while a parcel waits in a locker or
// pickup point. Works for every courier: tracking marks the parcel "out_for_delivery" when it
// reaches the box, we keep that moment, then remind the customer after X hours and once more
// shortly before the courier sends it back. Email only (WhatsApp outside the 24h window is paid).
import { prisma } from "../db.server.js";
import { sendMail, mailConfigured } from "./mail.server.js";
import { logActivity } from "./activity.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

// How long couriers usually keep a parcel in the box / point (days). The last-day email goes
// out half a day before this runs out.
export const PICKUP_HOLD_DAYS = { sameday: 2, fan: 2, cargus: 3, gls: 7, dpd: 7, packeta: 7 };
const holdDays = (courier) => PICKUP_HOLD_DAYS[courier] || 3;

const T = {
  ro: {
    s1: "Coletul tău te așteaptă la {point}", s2: "Ultima zi să ridici coletul — {point}",
    h1: "Coletul pentru comanda {order} a ajuns și te așteaptă.", h2: "Coletul pentru comanda {order} se întoarce în curând la magazin dacă nu e ridicat.",
    where: "Unde îl ridici", awb: "AWB", cod: "De plătit la ridicare: {amount}",
    code: "Codul de deschidere l-ai primit prin SMS sau email de la {courier}.", track: "Vezi statusul coletului", thanks: "Mulțumim!",
  },
  en: {
    s1: "Your parcel is waiting at {point}", s2: "Last day to collect your parcel — {point}",
    h1: "The parcel for order {order} has arrived and is waiting for you.", h2: "The parcel for order {order} will soon go back to the shop if it isn't collected.",
    where: "Pickup point", awb: "Tracking number", cod: "To pay on pickup: {amount}",
    code: "{courier} sent you the pickup code by SMS or email.", track: "Track your parcel", thanks: "Thank you!",
  },
  de: {
    s1: "Dein Paket wartet bei {point}", s2: "Letzter Tag zur Abholung — {point}",
    h1: "Das Paket zur Bestellung {order} ist angekommen und wartet auf dich.", h2: "Das Paket zur Bestellung {order} geht bald an den Shop zurück, wenn es nicht abgeholt wird.",
    where: "Abholstelle", awb: "Sendungsnummer", cod: "Bei Abholung zu zahlen: {amount}",
    code: "Den Abholcode hat dir {courier} per SMS oder E-Mail geschickt.", track: "Sendung verfolgen", thanks: "Danke!",
  },
  hu: {
    s1: "A csomagod vár: {point}", s2: "Utolsó nap a csomag átvételére — {point}",
    h1: "A(z) {order} rendelés csomagja megérkezett és vár rád.", h2: "A(z) {order} rendelés csomagja hamarosan visszamegy a boltba, ha nem veszed át.",
    where: "Átvételi pont", awb: "Csomagszám", cod: "Átvételkor fizetendő: {amount}",
    code: "Az átvételi kódot a(z) {courier} SMS-ben vagy e-mailben küldte el.", track: "Csomag követése", thanks: "Köszönjük!",
  },
  cs: {
    s1: "Tvůj balík čeká na {point}", s2: "Poslední den na vyzvednutí balíku — {point}",
    h1: "Balík k objednávce {order} dorazil a čeká na tebe.", h2: "Balík k objednávce {order} se brzy vrátí do obchodu, pokud nebude vyzvednut.",
    where: "Výdejní místo", awb: "Číslo zásilky", cod: "K úhradě při vyzvednutí: {amount}",
    code: "Kód pro vyzvednutí ti {courier} poslal SMS nebo e-mailem.", track: "Sledovat zásilku", thanks: "Děkujeme!",
  },
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COUNTRY_LANG = { RO: "ro", MD: "ro", HU: "hu", CZ: "cs", SK: "cs", DE: "de", AT: "de", CH: "de" };

export function reminderLang(settings, order) {
  const fixed = settings?.widgetLanguage && settings.widgetLanguage !== "auto" ? settings.widgetLanguage : null;
  const lang = fixed || COUNTRY_LANG[String(order?.shippingCountry || "RO").toUpperCase()] || "en";
  return T[lang] ? lang : "en";
}

// Which reminder is due for this order now: 1 (first), 2 (last day) or 0 (none)
export function dueReminder(order, settings, now = new Date()) {
  if (!settings?.pickupReminderEnabled || !order.readyForPickupAt) return 0;
  if (order.awbStatus !== "out_for_delivery" || order.shippingMethod !== "pickup_point" || !order.customerEmail) return 0;
  const ready = new Date(order.readyForPickupAt).getTime();
  const hours = Math.max(1, Number(settings.pickupReminderHours) || 24);
  const lastDayAt = ready + holdDays(order.courierType) * 86400e3 - 12 * 3600e3;
  const sent = order.pickupRemindersSent || 0;
  if (sent < 2 && settings.pickupReminderLastDay !== false && now.getTime() >= lastDayAt && lastDayAt - ready > hours * 3600e3) return 2;
  if (sent === 0 && now.getTime() >= ready + hours * 3600e3 && now.getTime() < lastDayAt) return 1;
  return 0;
}

export function reminderEmail(order, settings, which, shop) {
  const lang = reminderLang(settings, order);
  const t = T[lang];
  const courier = COURIER_LABELS[order.courierType]?.name || order.courierType || "";
  const point = order.pickupPointName || courier;
  const vars = { point, order: order.shopifyOrderName, courier, amount: `${Number(order.codAmount || 0).toFixed(2)} RON` };
  const subject = fill(which === 2 ? t.s2 : t.s1, vars);
  const lines = [
    fill(which === 2 ? t.h2 : t.h1, vars),
    `${t.where}: ${[order.pickupPointName, order.pickupPointAddress].filter(Boolean).join(", ")}`,
    order.awbNumber ? `${t.awb}: ${order.awbNumber}` : null,
    order.codAmount > 0 ? fill(t.cod, vars) : null,
    fill(t.code, vars),
  ].filter(Boolean);
  const trackUrl = `https://${shop}/apps/rocourier/track`;
  const shopName = settings?.whatsappName || settings?.senderName || shop.replace(".myshopify.com", "");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px">
${lines.map((l, i) => (i === 0 ? `<p style="font-size:17px"><b>${esc(l)}</b></p>` : `<p>${esc(l)}</p>`)).join("\n")}
<p><a href="${esc(trackUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(t.track)}</a></p>
<p>${esc(t.thanks)}<br>${esc(shopName)}</p></div>`;
  const text = [...lines, `${t.track}: ${trackUrl}`, "", t.thanks, shopName].join("\n");
  return { subject, html, text, fromName: shopName, replyTo: settings?.senderEmail || undefined };
}

// Hourly: send the reminders that are due, for every store that turned them on
export async function runPickupReminders(now = new Date()) {
  if (!mailConfigured()) return { sent: 0, skipped: "mail_not_configured" };
  const shops = await prisma.shopSettings.findMany({ where: { pickupReminderEnabled: true } });
  let sent = 0;
  for (const settings of shops) {
    const orders = await prisma.order.findMany({
      where: { shop: settings.shop, awbStatus: "out_for_delivery", shippingMethod: "pickup_point", readyForPickupAt: { not: null },
        pickupRemindersSent: { lt: 2 }, customerEmail: { not: null } },
      take: 500,
    });
    for (const order of orders) {
      const which = dueReminder(order, settings, now);
      if (!which) continue;
      const mail = reminderEmail(order, settings, which, settings.shop);
      const r = await sendMail({ to: order.customerEmail, ...mail });
      // Count it even when sending failed, so a bad address isn't retried every hour
      await prisma.order.update({ where: { id: order.id }, data: { pickupRemindersSent: which, pickupReminderAt: now } });
      if (r.sent) sent++;
      await logActivity({ shop: settings.shop, order, action: "pickup_reminder",
        message: r.sent ? `Reamintire ridicare colet trimisă pe email (${which === 2 ? "ultima zi" : "prima"})` : `Reamintirea de ridicare nu s-a trimis: ${r.reason}`,
        actor: "reminders" }).catch(() => {});
    }
  }
  return { sent };
}
