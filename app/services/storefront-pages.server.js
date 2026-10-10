// app/services/storefront-pages.server.js
// Customer-facing pages served through the app proxy (/apps/rocourier/...) and rendered
// inside the store's theme: order tracking and the return request form.
// Output is Liquid-rendered by Shopify, so every dynamic value is HTML-escaped and
// Liquid delimiters are neutralised.
import { prisma } from "../db.server.js";
import { trackingFor } from "./fulfillment.server.js";
import { findReturnableOrder, canReturn, createReturnRequest, RETURN_REASONS } from "./returns.server.js";
import { estimateDelivery } from "../utils/delivery-estimate.js";

export const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
  .replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");

const STATUS_RO = {
  pending: "Comanda e în pregătire", generated: "AWB generat — așteaptă curierul", picked_up: "Preluat de curier",
  in_transit: "În tranzit", out_for_delivery: "În livrare / gata de ridicare", delivered: "Livrat",
  returned: "Returnat la expeditor", failed: "Livrare eșuată", cancelled: "Anulat",
};
const STEPS = ["generated", "picked_up", "in_transit", "out_for_delivery", "delivered"];

const STYLE = `<style>
.pk-wrap{max-width:640px;margin:32px auto;padding:0 16px;font:inherit;color:inherit}
.pk-wrap h1{font-size:1.6em;margin:0 0 8px}
.pk-card{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:18px;margin:16px 0}
.pk-muted{opacity:.7;font-size:.92em}
.pk-field{display:flex;flex-direction:column;gap:6px;margin:0 0 14px}
.pk-field input,.pk-field select,.pk-field textarea{font:inherit;padding:10px;border:1px solid rgba(0,0,0,.25);border-radius:6px;background:transparent;color:inherit}
.pk-btn{font:inherit;padding:11px 18px;border-radius:6px;border:0;background:#111;color:#fff;cursor:pointer}
.pk-err{background:#fdecea;color:#8a1c12;padding:10px 12px;border-radius:6px;margin:0 0 14px}
.pk-ok{background:#e6f4ea;color:#0f5c2e;padding:10px 12px;border-radius:6px;margin:0 0 14px}
.pk-steps{display:flex;gap:4px;margin:14px 0}
.pk-steps span{flex:1;height:6px;border-radius:3px;background:rgba(0,0,0,.12)}
.pk-steps span.on{background:#1a7f4b}
.pk-ev{display:flex;gap:12px;padding:8px 0;border-top:1px solid rgba(0,0,0,.08)}
.pk-ev time{white-space:nowrap;opacity:.7;font-size:.9em;min-width:118px}
.pk-items label{display:flex;gap:10px;align-items:center;margin:6px 0}
.pk-items input[type=number]{width:64px}
</style>`;

const page = (title, body) => `${STYLE}<div class="pk-wrap"><h1>${esc(title)}</h1>${body}</div>`;
const fmtDate = (d) => new Date(d).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function lookupForm(action, { orderName = "", contact = "", error = null, button = "Caută comanda" } = {}) {
  return `${error ? `<p class="pk-err">${esc(error)}</p>` : ""}
<form method="get" action="${esc(action)}" class="pk-card">
  <div class="pk-field"><label for="pk-order">Numărul comenzii</label><input id="pk-order" name="order" value="${esc(orderName)}" placeholder="ex: 1024" required></div>
  <div class="pk-field"><label for="pk-contact">Emailul sau telefonul din comandă</label><input id="pk-contact" name="contact" value="${esc(contact)}" required></div>
  <button class="pk-btn" type="submit">${esc(button)}</button>
</form>`;
}

// ── Tracking ─────────────────────────────────────────────────────────────────
export async function trackingPage(shop, params) {
  const orderName = params.get("order") || "";
  const contact = params.get("contact") || "";
  if (!orderName || !contact) return page("Unde e coletul meu?", lookupForm("/apps/rocourier/track"));

  const { order, error } = await findReturnableOrder(shop, { orderName, contact });
  if (error) return page("Unde e coletul meu?", lookupForm("/apps/rocourier/track", { orderName, contact, error }));

  const [events, settings] = await Promise.all([
    prisma.awbEvent.findMany({ where: { orderId: order.id }, orderBy: { eventDate: "desc" }, take: 30 }),
    prisma.shopSettings.findUnique({ where: { shop }, select: { dispatchCutoffHour: true, processingDays: true, returnsEnabled: true } }),
  ]);
  const step = STEPS.indexOf(order.awbStatus);
  const link = order.awbNumber ? trackingFor(order.courierType, order.awbNumber).url : null;
  const eta = !["delivered", "returned", "failed", "cancelled"].includes(order.awbStatus)
    ? estimateDelivery({ now: new Date(order.createdAt), cutoffHour: settings?.dispatchCutoffHour ?? 14, processingDays: settings?.processingDays ?? 0 })
    : null;
  const etaText = eta && new Date(eta.maxDate) > new Date()
    ? `<p>Livrare estimată: <strong>${eta.minDate.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" })}</strong></p>` : "";

  const body = `<div class="pk-card">
  <p class="pk-muted">Comanda ${esc(order.shopifyOrderName)}</p>
  <h2 style="margin:4px 0">${esc(STATUS_RO[order.awbStatus] || order.awbStatus)}</h2>
  <div class="pk-steps">${STEPS.map((_, i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("")}</div>
  ${etaText}
  ${order.shippingMethod === "pickup_point" && order.pickupPointName ? `<p>Ridicare din: <strong>${esc(order.pickupPointName)}</strong><br><span class="pk-muted">${esc(order.pickupPointAddress || "")}</span></p>
  <p class="pk-muted">Codul de deschidere al lockerului vine prin SMS sau email când coletul ajunge.</p>` : ""}
  ${order.awbNumber ? `<p>AWB: <strong>${esc(order.awbNumber)}</strong>${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">vezi la curier</a>` : ""}</p>` : ""}
</div>
${events.length ? `<div class="pk-card">${events.map((e) => `<div class="pk-ev"><time>${esc(fmtDate(e.eventDate))}</time><div>${esc(e.eventDesc || "")}${e.location ? `<div class="pk-muted">${esc(e.location)}</div>` : ""}</div></div>`).join("")}</div>` : ""}
${settings?.returnsEnabled && order.awbStatus === "delivered" ? `<p><a href="/apps/rocourier/returns?order=${encodeURIComponent(order.shopifyOrderName.replace("#", ""))}&amp;contact=${encodeURIComponent(contact)}">Vrei să returnezi ceva? Cere returul aici</a></p>` : ""}`;
  return page("Unde e coletul meu?", body);
}

// ── Returns ──────────────────────────────────────────────────────────────────
async function lineItemsFor(admin, order) {
  if (!admin) return [];
  try {
    const res = await admin.graphql(`query ($id: ID!) { order(id: $id) { lineItems(first: 50) { nodes { name sku quantity currentQuantity } } } }`,
      { variables: { id: `gid://shopify/Order/${order.shopifyOrderId}` } });
    return ((await res.json()).data?.order?.lineItems?.nodes || [])
      .map((i) => ({ name: i.name, sku: i.sku || "", quantity: i.currentQuantity ?? i.quantity }))
      .filter((i) => i.quantity > 0);
  } catch { return []; }
}

export async function returnsPage(shop, params, admin, { submitted = null, error = null, values = {} } = {}) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const title = "Retur produse";
  if (!settings?.returnsEnabled) return page(title, `<p>Retururile online nu sunt disponibile. Contactează magazinul.</p>`);
  if (submitted) {
    return page(title, `<p class="pk-ok">Am primit cererea de retur pentru comanda ${esc(submitted.shopifyOrderName)}. Te anunțăm pe email când e aprobată și primești AWB-ul de retur.</p>
${settings.returnsInstructions ? `<div class="pk-card">${esc(settings.returnsInstructions).replace(/\n/g, "<br>")}</div>` : ""}`);
  }

  const orderName = params.get("order") || values.order || "";
  const contact = params.get("contact") || values.contact || "";
  const intro = `<p class="pk-muted">Ai ${settings.returnsWindowDays} zile de la livrare să ne trimiți produsele înapoi.</p>`;
  if (!orderName || !contact) return page(title, intro + lookupForm("/apps/rocourier/returns", { error, button: "Continuă" }));

  const { order, error: findErr } = await findReturnableOrder(shop, { orderName, contact });
  if (findErr) return page(title, intro + lookupForm("/apps/rocourier/returns", { orderName, contact, error: findErr, button: "Continuă" }));
  const blocked = await canReturn(shop, order, settings);
  if (blocked) return page(title, `<p class="pk-err">${esc(blocked)}</p>`);

  const items = await lineItemsFor(admin, order);
  const body = `${error ? `<p class="pk-err">${esc(error)}</p>` : ""}
<form method="post" action="/apps/rocourier/returns" class="pk-card">
  <input type="hidden" name="order" value="${esc(orderName)}"><input type="hidden" name="contact" value="${esc(contact)}">
  <p>Comanda <strong>${esc(order.shopifyOrderName)}</strong></p>
  <fieldset class="pk-field pk-items" style="border:0;padding:0"><legend>Ce returnezi?</legend>
    ${items.length ? items.map((it, i) => `<label><input type="checkbox" name="item_${i}" value="1"> <input type="number" name="qty_${i}" min="1" max="${it.quantity}" value="${it.quantity}" aria-label="Cantitate"> ${esc(it.name)}
      <input type="hidden" name="name_${i}" value="${esc(it.name)}"><input type="hidden" name="sku_${i}" value="${esc(it.sku)}"></label>`).join("")
      : `<textarea name="free_items" rows="3" placeholder="Scrie produsele și cantitățile"></textarea>`}
    <input type="hidden" name="item_count" value="${items.length}">
  </fieldset>
  <div class="pk-field"><label for="pk-reason">Motivul</label><select id="pk-reason" name="reason" required><option value="">Alege…</option>${RETURN_REASONS.map((r) => `<option>${esc(r)}</option>`).join("")}</select></div>
  <div class="pk-field"><label for="pk-comment">Detalii (opțional)</label><textarea id="pk-comment" name="comment" rows="3"></textarea></div>
  <div class="pk-field"><label for="pk-iban">IBAN pentru rambursare (doar dacă ai plătit ramburs)</label><input id="pk-iban" name="iban" placeholder="RO49AAAA1B31007593840000"></div>
  <p class="pk-muted">Curierul va ridica coletul de la adresa de livrare a comenzii. Pregătește produsele în ambalaj.</p>
  <button class="pk-btn" type="submit">Trimite cererea de retur</button>
</form>`;
  return page(title, body);
}

export async function submitReturn(shop, form) {
  const orderName = form.get("order");
  const contact = form.get("contact");
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const { order, error } = await findReturnableOrder(shop, { orderName, contact });
  if (error) return { error };
  const blocked = await canReturn(shop, order, settings);
  if (blocked) return { error: blocked };

  const count = parseInt(form.get("item_count")) || 0;
  let items = [];
  for (let i = 0; i < count; i++) {
    if (form.get(`item_${i}`)) items.push({ name: form.get(`name_${i}`), sku: form.get(`sku_${i}`) || "", quantity: parseInt(form.get(`qty_${i}`)) || 1 });
  }
  if (!count && form.get("free_items")) items = [{ name: String(form.get("free_items")).slice(0, 500), sku: "", quantity: 1 }];
  try {
    const rr = await createReturnRequest(shop, order, { items, reason: form.get("reason"), comment: form.get("comment"), iban: form.get("iban") || null });
    return { submitted: rr };
  } catch (e) {
    return { error: e.message };
  }
}
