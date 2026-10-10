// app/services/cod.server.js
// Cash-on-delivery reconciliation: which COD parcels were delivered, which ones the
// courier has already paid out, and which payments are late.
// DPD reports payouts through its API; other couriers send a statement ("borderou")
// that the merchant uploads as CSV.
import { prisma } from "../db.server.js";
import { dpdGetCodPayouts } from "./dpd.server.js";
import { collectInvoice } from "./invoice.server.js";
import { logActivity } from "./activity.server.js";

const LATE_AFTER_DAYS = 10; // couriers usually pay COD within 2–7 working days

// ── CSV statement parsing ────────────────────────────────────────────────────
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = [";", "\t", ","].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (h) => String(h || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const parseAmount = (v) => {
  let s = String(v || "").replace(/[^\d,.-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const parseDate = (v) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
};

// Finds the AWB, amount and date columns of a courier statement by their headers.
export function readCodStatement(text) {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => /awb|expeditie|colet|parcel|shipment/.test(norm(c))));
  if (headerIdx === -1) throw new Error("Nu am găsit coloana cu AWB în fișier. Exportă borderoul ca CSV, cu capul de tabel.");
  const header = rows[headerIdx].map(norm);
  const find = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const awbCol = find(/awb|nr\.? expeditie|numar expeditie|colet|parcel|shipment/);
  const amountCol = find(/ramburs|suma|valoare|amount|cod|incasat/, /cost|tarif|taxa|comision|data|date/);
  const dateCol = find(/data|date/);
  if (amountCol === -1) throw new Error("Nu am găsit coloana cu suma rambursului (ramburs / sumă / valoare).");

  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const awb = String(r[awbCol] || "").replace(/\s/g, "");
    const amount = parseAmount(r[amountCol]);
    if (!/^\w{5,}$/.test(awb) || amount == null || amount <= 0) continue;
    out.push({ awbNumber: awb, amount, paidAt: dateCol >= 0 ? parseDate(r[dateCol]) : null });
  }
  return out;
}

// ── Store + match ────────────────────────────────────────────────────────────
async function recordPayouts(shop, courier, rows, { source }) {
  let matched = 0, unmatched = 0, created = 0;
  for (const p of rows) {
    const order = await prisma.order.findFirst({ where: { shop, awbNumber: p.awbNumber } });
    const existing = await prisma.codPayout.findUnique({ where: { shop_courier_awbNumber: { shop, courier, awbNumber: p.awbNumber } } });
    if (!existing) created++;
    await prisma.codPayout.upsert({
      where: { shop_courier_awbNumber: { shop, courier, awbNumber: p.awbNumber } },
      create: { shop, courier, awbNumber: p.awbNumber, amount: p.amount, currency: p.currency || "RON", paidAt: p.paidAt || new Date(), documentId: p.documentId || null, orderId: order?.id || null },
      update: { amount: p.amount, paidAt: p.paidAt || undefined, orderId: order?.id || null },
    });
    if (!order) { unmatched++; continue; }
    matched++;
    if (!order.codCollectedAt) {
      await prisma.order.update({ where: { id: order.id }, data: { codCollectedAmount: p.amount, codCollectedAt: p.paidAt || new Date(), codPayoutRef: p.documentId || source } });
      const diff = Math.round((p.amount - (order.codAmount || 0)) * 100) / 100;
      await logActivity({ shop, order, action: "cod_reconciled", actor: "automation",
        message: `Ramburs încasat: ${p.amount.toFixed(2)} RON${Math.abs(diff) >= 0.01 ? ` (diferență ${diff > 0 ? "+" : ""}${diff.toFixed(2)} RON față de comandă)` : ""}` });
      // The money is in: record the payment on the invoice
      await collectInvoice(shop, { ...order, codCollectedAmount: p.amount }).catch((e) =>
        console.error(`[COD] invoice collect failed for ${order.shopifyOrderName}:`, e.message));
    }
  }
  return { matched, unmatched, created };
}

export async function importCodStatement(shop, courier, text) {
  const rows = readCodStatement(text);
  if (!rows.length) throw new Error("Fișierul nu conține rânduri cu AWB și sumă.");
  return { rows: rows.length, ...(await recordPayouts(shop, courier, rows, { source: "import" })) };
}

// Pulls DPD payouts since the last sync (max 60 days back).
export async function syncCodFromApis(shop) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const results = {};
  if (settings?.dpdEnabled && settings.dpdUsername) {
    const from = settings.codSyncedAt ? new Date(settings.codSyncedAt.getTime() - 3 * 864e5) : new Date(Date.now() - 60 * 864e5);
    const rows = await dpdGetCodPayouts({ username: settings.dpdUsername, password: settings.dpdPassword, from, to: new Date() });
    results.dpd = await recordPayouts(shop, "dpd", rows, { source: "dpd-api" });
  }
  await prisma.shopSettings.update({ where: { shop }, data: { codSyncedAt: new Date() } });
  return results;
}

export async function syncCodForAllShops() {
  const shops = await prisma.shopSettings.findMany({ where: { dpdEnabled: true, dpdUsername: { not: null } }, select: { shop: true } });
  for (const { shop } of shops) {
    await syncCodFromApis(shop).catch((e) => console.error(`[COD] sync failed for ${shop}:`, e.message));
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────
export async function codOverview(shop) {
  const lateBefore = new Date(Date.now() - LATE_AFTER_DAYS * 864e5);
  const deliveredCod = { shop, awbStatus: "delivered", codAmount: { gt: 0 } };
  const [awaiting, late, collected, recentPayouts, unmatched] = await Promise.all([
    prisma.order.aggregate({ where: { ...deliveredCod, codCollectedAt: null }, _sum: { codAmount: true }, _count: true }),
    prisma.order.findMany({
      where: { ...deliveredCod, codCollectedAt: null, OR: [{ deliveredAt: { lt: lateBefore } }, { deliveredAt: null, updatedAt: { lt: lateBefore } }] },
      select: { id: true, shopifyOrderName: true, awbNumber: true, courierType: true, codAmount: true, deliveredAt: true, updatedAt: true },
      orderBy: { deliveredAt: "asc" }, take: 100,
    }),
    prisma.order.aggregate({ where: { shop, codCollectedAt: { gte: new Date(Date.now() - 30 * 864e5) } }, _sum: { codCollectedAmount: true }, _count: true }),
    prisma.codPayout.findMany({ where: { shop }, orderBy: { paidAt: "desc" }, take: 50 }),
    prisma.codPayout.count({ where: { shop, orderId: null } }),
  ]);
  return {
    awaitingAmount: awaiting._sum.codAmount || 0, awaitingCount: awaiting._count,
    collected30Amount: collected._sum.codCollectedAmount || 0, collected30Count: collected._count,
    late, recentPayouts, unmatched, lateAfterDays: LATE_AFTER_DAYS,
  };
}
