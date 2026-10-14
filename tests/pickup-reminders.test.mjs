// Email reminders for parcels waiting in a locker. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { dueReminder, reminderEmail, reminderLang, PICKUP_HOLD_DAYS } from "../app/services/pickup-reminders.server.js";

const H = 3600e3;
const ready = new Date("2026-10-10T08:00:00Z");
const at = (h) => new Date(ready.getTime() + h * H);
const settings = { pickupReminderEnabled: true, pickupReminderHours: 24, pickupReminderLastDay: true, senderName: "Magazin" };
const order = { shopifyOrderName: "#1001", awbNumber: "1ONB123", courierType: "packeta", shippingMethod: "pickup_point", awbStatus: "out_for_delivery",
  customerEmail: "c@example.com", readyForPickupAt: ready, pickupRemindersSent: 0, codAmount: 149.9, pickupPointName: "Z-BOX Cluj 12", pickupPointAddress: "Str. Memorandumului 1", shippingCountry: "RO" };

test("reminders: first after X hours, last day before the courier's hold runs out, then nothing", () => {
  assert.equal(dueReminder(order, settings, at(23)), 0);
  assert.equal(dueReminder(order, settings, at(25)), 1);
  const last = PICKUP_HOLD_DAYS.packeta * 24 - 12;
  assert.equal(dueReminder({ ...order, pickupRemindersSent: 1 }, settings, at(last - 1)), 0);
  assert.equal(dueReminder({ ...order, pickupRemindersSent: 1 }, settings, at(last)), 2);
  assert.equal(dueReminder({ ...order, pickupRemindersSent: 2 }, settings, at(last + 5)), 0);
  // first one missed (e.g. tracking late): only the last-day one goes out
  assert.equal(dueReminder(order, settings, at(last + 1)), 2);
});

test("reminders: off, collected, home delivery, no email or short hold → none", () => {
  assert.equal(dueReminder(order, { ...settings, pickupReminderEnabled: false }, at(30)), 0);
  assert.equal(dueReminder({ ...order, awbStatus: "delivered" }, settings, at(30)), 0);
  assert.equal(dueReminder({ ...order, shippingMethod: "home_delivery" }, settings, at(30)), 0);
  assert.equal(dueReminder({ ...order, customerEmail: null }, settings, at(30)), 0);
  // Sameday keeps 2 days: last-day mail at 36h; with a 24h first reminder both fit
  const sd = { ...order, courierType: "sameday" };
  assert.equal(dueReminder(sd, settings, at(25)), 1);
  assert.equal(dueReminder({ ...sd, pickupRemindersSent: 1 }, settings, at(36)), 2);
  // first reminder at 40h would come after the last-day one → only last day
  assert.equal(dueReminder(sd, { ...settings, pickupReminderHours: 40 }, at(37)), 0);
});

test("reminders: email in the customer's language with point, AWB and COD", () => {
  const m = reminderEmail(order, settings, 1, "shop.myshopify.com");
  assert.match(m.subject, /Z-BOX Cluj 12/);
  assert.match(m.text, /1ONB123/);
  assert.match(m.text, /149\.90 RON/);
  assert.match(m.html, /apps\/rocourier\/track/);
  assert.equal(reminderLang(settings, { shippingCountry: "HU" }), "hu");
  assert.equal(reminderLang({ widgetLanguage: "en" }, { shippingCountry: "RO" }), "en");
  assert.match(reminderEmail({ ...order, shippingCountry: "CZ", codAmount: 0 }, settings, 2, "s.myshopify.com").subject, /Poslední den/);
});
