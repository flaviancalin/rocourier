// app/services/withdrawal.server.js — the "withdraw from contract" function required for online
// sales to EU consumers (Directive 2023/2673; in Romania OUG 18/2026). Two steps on the store
// (choose, then confirm), an acknowledgement on a durable medium (email + Shopify order record),
// and a request the merchant handles in Picklo → Returns, with the 14-day refund deadline.
import { prisma } from "../db.server.js";
import { logActivity } from "./activity.server.js";
import { flowReturnRequested } from "./flow.server.js";
import { sendMail } from "./mail.server.js";
import { esc, page, lineItemsFor } from "./storefront-pages.server.js";
import { wt, pickLang, withdrawalRef, withdrawalDeadline, WITHDRAWAL_DAYS } from "../utils/withdrawal.js";

const DAY = 864e5;
const PATH = "/apps/rocourier/withdraw";
const digits = (x) => String(x || "").replace(/\D/g, "").slice(-9);

export function withdrawalLang(settings, params) {
  return pickLang(params?.get?.("lang") || (settings?.widgetLanguage !== "auto" ? settings?.widgetLanguage : "") || "ro");
}

// The order and how the customer proved it's theirs: logged in as the order's customer,
// or the order number plus the email/phone used on it.
export async function findOrderForWithdrawal(shop, { oid, orderName, contact, loggedInCustomerId, admin }) {
  let order = null;
  if (oid) order = await prisma.order.findFirst({ where: { shop, shopifyOrderId: String(oid).replace(/\D/g, "") } });
  else if (orderName) order = await prisma.order.findFirst({ where: { shop, shopifyOrderName: `#${String(orderName).trim().replace(/^#/, "")}` } });
  if (!order) return { error: "errOrder" };

  if (loggedInCustomerId && admin) {
    try {
      const res = await admin.graphql(`query ($id: ID!) { order(id: $id) { customer { id } } }`, { variables: { id: `gid://shopify/Order/${order.shopifyOrderId}` } });
      const cid = (await res.json()).data?.order?.customer?.id || "";
      if (cid.endsWith(`/${loggedInCustomerId}`)) return { order, verified: true };
    } catch (_) { /* fall back to the contact check */ }
  }
  const c = String(contact || "").trim().toLowerCase();
  if (!c) return { order, verified: false };
  const emailOk = c.includes("@") && order.customerEmail?.toLowerCase() === c;
  const phoneOk = !c.includes("@") && digits(c).length === 9 && digits(order.customerPhone) === digits(c);
  return emailOk || phoneOk ? { order, verified: true } : { error: "errContact" };
}

// null when the order can be withdrawn from, else the text key of the reason it can't
export async function canWithdraw(shop, order, settings) {
  if (!settings?.withdrawalEnabled) return "errOff";
  if (order.shopifyCancelledAt) return "errCancelled";
  const deadline = withdrawalDeadline(order, settings.returnsWindowDays);
  if (deadline && Date.now() > deadline.getTime()) return "errExpired";
  const open = await prisma.returnRequest.findFirst({ where: { shop, orderId: order.id, status: { in: ["requested", "approved", "awb_generated"] } } });
  return open ? "errOpen" : null;
}

function itemsTable(lang, items) {
  return `<table style="border-collapse:collapse;width:100%;margin:12px 0"><tr><th align="left" style="border-bottom:1px solid #ddd;padding:6px">${esc(wt(lang, "product"))}</th><th align="right" style="border-bottom:1px solid #ddd;padding:6px">${esc(wt(lang, "qty"))}</th></tr>${items.map((i) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(i.name)}</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">${esc(i.quantity)}</td></tr>`).join("")}</table>`;
}

const fmt = (d, lang) => new Date(d).toLocaleString(lang === "en" ? "en-GB" : lang, { timeZone: "Europe/Bucharest", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Records the withdrawal, then acknowledges it: email to the customer, note to the merchant,
// tag + timeline note on the Shopify order (kept even if the email can't go out).
export async function createWithdrawal(shop, order, { items, reason, via = "site", lang = "ro", admin = null }) {
  const chosen = (items || []).filter((i) => i.name && Number(i.quantity) > 0);
  if (!chosen.length) throw new Error(wt(lang, "errItems"));
  const now = new Date();
  const rr = await prisma.returnRequest.create({
    data: {
      shop, orderId: order.id, shopifyOrderName: order.shopifyOrderName, kind: "withdrawal",
      customerName: order.customerName, customerEmail: order.customerEmail, customerPhone: order.customerPhone,
      items: chosen, reason: reason ? String(reason).slice(0, 200) : wt("ro", "noReason"),
      method: "courier", requestedVia: via, refundDueAt: new Date(now.getTime() + WITHDRAWAL_DAYS * DAY),
    },
  });
  const ref = withdrawalRef(rr.id);
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const shopName = settings?.whatsappName || settings?.senderName || shop.replace(".myshopify.com", "");

  // Customer: acknowledgement on a durable medium
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2>${esc(wt(lang, "doneTitle"))}</h2>
<p>${esc(wt(lang, "emailIntro"))}</p>
<p><strong>${esc(wt(lang, "refNo"))}:</strong> ${esc(ref)}<br><strong>${esc(wt(lang, "dateLabel"))}:</strong> ${esc(fmt(now, lang))}<br><strong>${esc(wt(lang, "orderNo"))}:</strong> ${esc(order.shopifyOrderName)}</p>
${itemsTable(lang, chosen)}
<p>${esc(wt(lang, "next"))}</p><p>${esc(shopName)}</p></div>`;
  const mail = await sendMail({
    to: order.customerEmail, subject: wt(lang, "subject", { order: order.shopifyOrderName }), html,
    text: `${wt(lang, "emailIntro")}\n${wt(lang, "refNo")}: ${ref}\n${wt(lang, "dateLabel")}: ${fmt(now, lang)}\n${chosen.map((i) => `${i.quantity} × ${i.name}`).join("\n")}\n\n${wt(lang, "next")}`,
    replyTo: settings?.senderEmail || undefined, fromName: shopName,
  });
  if (mail.sent) await prisma.returnRequest.update({ where: { id: rr.id }, data: { confirmationSentAt: new Date() } });

  // Merchant: heads-up with the refund deadline
  if (settings?.senderEmail) {
    await sendMail({
      to: settings.senderEmail, fromName: "Picklo",
      subject: wt("ro", "merchantSubject", { order: order.shopifyOrderName }),
      html: `<p>${esc(wt("ro", "merchantIntro", { name: order.customerName || "Clientul", order: order.shopifyOrderName, due: fmt(rr.refundDueAt, "ro") }))}</p>${itemsTable("ro", chosen)}<p>Picklo → Retururi.</p>`,
    }).catch(() => {});
  }

  // Shopify order record: tag + note, so the proof also lives on the order itself
  if (admin) {
    try {
      const gid = `gid://shopify/Order/${order.shopifyOrderId}`;
      await admin.graphql(`mutation ($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { variables: { id: gid, tags: ["retragere-contract"] } });
    } catch (_) {}
  }

  await logActivity({ shop, order, action: "withdrawal_requested", actor: "customer",
    message: `Retragere din contract ${ref} (${chosen.length} produs(e))${mail.sent ? ", confirmare trimisă pe email" : `, confirmare email netrimisă: ${mail.reason}`}` });
  flowReturnRequested(shop, order, "withdrawal");
  return { rr, ref, emailed: mail.sent, at: now };
}

// ── Customer page (/apps/rocourier/withdraw) ────────────────────────────────
function findForm(lang, { orderName = "", contact = "", error = null } = {}) {
  return `${error ? `<p class="pk-err">${esc(wt(lang, error, { days: WITHDRAWAL_DAYS }))}</p>` : ""}
<form method="get" action="${PATH}" class="pk-card">
  <input type="hidden" name="lang" value="${esc(lang)}">
  <div class="pk-field"><label for="pk-order">${esc(wt(lang, "orderNo"))}</label><input id="pk-order" name="order" value="${esc(orderName)}" placeholder="1024" required></div>
  <div class="pk-field"><label for="pk-contact">${esc(wt(lang, "contact"))}</label><input id="pk-contact" name="contact" value="${esc(contact)}" required></div>
  <button class="pk-btn" type="submit">${esc(wt(lang, "continue"))}</button>
</form>`;
}

const hidden = (o) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");

// GET: find the order → choose items. POST step=review: show what will be withdrawn and ask
// to confirm. POST step=confirm: record it and show the acknowledgement.
export async function withdrawalPage(shop, params, admin, { loggedInCustomerId = null, form = null } = {}) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const lang = withdrawalLang(settings, form || params);
  const title = wt(lang, "title");
  const get = (k) => (form ? form.get(k) : null) ?? params.get(k) ?? "";
  const intro = `<p class="pk-muted">${esc(wt(lang, "intro", { days: Math.max(WITHDRAWAL_DAYS, settings?.returnsWindowDays || 0) }))}</p>`;
  if (!settings?.withdrawalEnabled) return page(title, `<p>${esc(wt(lang, "errOff"))}</p>`);

  const oid = get("oid"), orderName = get("order"), contact = get("contact");
  if (!oid && !orderName) return page(title, intro + findForm(lang));
  const found = await findOrderForWithdrawal(shop, { oid, orderName, contact, loggedInCustomerId, admin });
  if (found.error) return page(title, intro + findForm(lang, { orderName, contact, error: found.error }));
  if (!found.verified) return page(title, intro + findForm(lang, { orderName: found.order.shopifyOrderName.replace("#", ""), contact, error: contact ? "errContact" : null }));
  const { order } = found;
  const blocked = await canWithdraw(shop, order, settings);
  if (blocked) return page(title, `<p class="pk-err">${esc(wt(lang, blocked, { days: WITHDRAWAL_DAYS }))}</p>`);

  const keep = { lang, oid, order: orderName, contact };
  const lines = await lineItemsFor(admin, order);
  const step = form?.get("step");

  // Chosen items from the form (all lines when the customer withdraws from the whole order)
  const chosenFromForm = () => {
    if (form.get("all") === "1" || !lines.length) return lines.length ? lines : [{ name: order.shopifyOrderName, sku: "", quantity: 1 }];
    return lines.map((l, i) => (form.get(`item_${i}`) ? { ...l, quantity: Math.min(l.quantity, Math.max(1, parseInt(form.get(`qty_${i}`)) || 1)) } : null)).filter(Boolean);
  };

  if (step === "confirm") {
    let items;
    try { items = JSON.parse(form.get("items") || "[]"); } catch { items = []; }
    try {
      const r = await createWithdrawal(shop, order, { items, reason: form.get("reason") || null, via: loggedInCustomerId ? "account" : "site", lang, admin });
      return page(wt(lang, "doneTitle"), `<p class="pk-ok">${esc(wt(lang, "done", { order: order.shopifyOrderName, date: fmt(r.at, lang), ref: r.ref }))}</p>
<div class="pk-card">${itemsTable(lang, r.rr.items)}<p>${esc(r.emailed ? wt(lang, "emailSent", { email: order.customerEmail }) : wt(lang, "emailMissing"))}</p><p class="pk-muted">${esc(wt(lang, "next"))}</p></div>`);
    } catch (e) {
      return page(title, `<p class="pk-err">${esc(e.message)}</p>`);
    }
  }

  if (step === "review") {
    const items = chosenFromForm();
    if (!items.length) return page(title, `<p class="pk-err">${esc(wt(lang, "errItems"))}</p>`);
    return page(wt(lang, "confirmTitle"), `<form method="post" action="${PATH}" class="pk-card">${hidden({ ...keep, step: "confirm", reason: form.get("reason") || "" })}
<input type="hidden" name="items" value="${esc(JSON.stringify(items))}">
<p>${esc(wt(lang, "confirmText", { order: order.shopifyOrderName }))}</p>${itemsTable(lang, items)}
<button class="pk-btn" type="submit">${esc(wt(lang, "confirm"))}</button>
<p class="pk-muted"><a href="${PATH}?${new URLSearchParams(Object.entries(keep).filter(([, v]) => v)).toString().replace(/&/g, "&amp;")}">${esc(wt(lang, "back"))}</a></p></form>`);
  }

  return page(title, `${intro}<form method="post" action="${PATH}" class="pk-card">${hidden({ ...keep, step: "review" })}
<p><strong>${esc(order.shopifyOrderName)}</strong></p>
<fieldset class="pk-field pk-items" style="border:0;padding:0"><legend>${esc(wt(lang, "pick"))}</legend>
  <label><input type="checkbox" name="all" value="1" checked> ${esc(wt(lang, "all"))}</label>
  ${lines.map((it, i) => `<label><input type="checkbox" name="item_${i}" value="1"> <input type="number" name="qty_${i}" min="1" max="${esc(it.quantity)}" value="${esc(it.quantity)}" aria-label="${esc(wt(lang, "qty"))}"> ${esc(it.name)}</label>`).join("")}
</fieldset>
<div class="pk-field"><label for="pk-reason">${esc(wt(lang, "reasonOpt"))}</label><textarea id="pk-reason" name="reason" rows="2"></textarea></div>
<button class="pk-btn" type="submit">${esc(wt(lang, "withdraw"))}</button></form>`);
}
