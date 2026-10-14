// app/services/profit.server.js — profit per order. Shopify gives the money side (totals, tax,
// refunds) and the product unit costs; Picklo adds the real courier cost from the AWB.
import { prisma } from "../db.server.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// VAT rate the store invoices with (0 = not a VAT payer), from the invoicing settings
export function storeVatRate(settings) {
  const p = settings?.invoiceProvider;
  const raw = p === "oblio" ? settings?.oblioTVA : p === "fgo" ? settings?.fgoTVA : settings?.smartbillTVA;
  const n = Number.parseFloat(raw ?? "21");
  return Number.isFinite(n) && n >= 0 ? n : 21;
}

// → { revenueNet, cogs, shipping, paymentFee, returnCost, profit, margin, complete }
export function computeProfit(order, settings) {
  const vat = storeVatRate(settings);
  const vatPayer = vat > 0;
  const total = Number(order.orderTotal) || 0;
  const tax = order.taxAmount != null ? Number(order.taxAmount) : (vatPayer ? total - total / (1 + vat / 100) : 0);
  const refunded = Number(order.refundedAmount) || 0;
  const refundedNet = vatPayer ? refunded / (1 + vat / 100) : refunded;
  const returned = order.awbStatus === "returned";

  const revenueNet = returned ? 0 : Math.max(0, total - tax - refundedNet);
  // Courier invoices carry VAT the store deducts when it's a VAT payer
  const shippingGross = Number(order.shippingCost) || 0;
  const shipping = vatPayer ? shippingGross / (1 + vat / 100) : shippingGross;
  const returnCost = returned ? shipping : 0; // the parcel comes back at about the same price
  const cogs = returned ? 0 : Number(order.cogsAmount) || 0;
  const paidByCard = !(Number(order.codAmount) > 0);
  const paymentFee = paidByCard && !returned ? total * (Number(settings?.paymentFeePercent) || 0) / 100 : 0;

  const profit = revenueNet - cogs - shipping - returnCost - paymentFee;
  return {
    revenueNet: r2(revenueNet), cogs: r2(cogs), shipping: r2(shipping), returnCost: r2(returnCost), paymentFee: r2(paymentFee),
    profit: r2(profit), margin: revenueNet > 0 ? Math.round((profit / revenueNet) * 1000) / 10 : null,
    complete: order.profitSyncedAt != null && !order.cogsMissing && order.shippingCost != null,
  };
}

const ORDER_FIN = `... on Order { id
  totalTaxSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 100) { nodes { quantity currentQuantity variant { inventoryItem { unitCost { amount } } } } } }`;

// Pulls cost and tax data for the given orders from Shopify and stores it (25 per request)
export async function syncOrderFinancials(admin, orders) {
  let synced = 0;
  for (let i = 0; i < orders.length; i += 25) {
    const chunk = orders.slice(i, i + 25);
    const ids = chunk.map((o) => `gid://shopify/Order/${o.shopifyOrderId}`);
    let nodes = [];
    try {
      const res = await admin.graphql(`query ($ids: [ID!]!) { nodes(ids: $ids) { ${ORDER_FIN} } }`, { variables: { ids } });
      const body = await res.json();
      if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
      nodes = body.data?.nodes || [];
    } catch (e) {
      // Missing read_products/read_inventory: keep going with what we have
      console.error("[profit] Shopify financials:", e.message || e);
      return { synced, error: e.message || String(e) };
    }
    for (const n of nodes) {
      if (!n?.id) continue;
      const order = chunk.find((o) => n.id.endsWith(`/${o.shopifyOrderId}`));
      if (!order) continue;
      let cogs = 0, missing = false;
      for (const li of n.lineItems?.nodes || []) {
        const qty = li.currentQuantity ?? li.quantity ?? 0;
        if (!qty) continue;
        const cost = li.variant?.inventoryItem?.unitCost?.amount;
        if (cost == null) { missing = true; continue; }
        cogs += Number(cost) * qty;
      }
      await prisma.order.update({ where: { id: order.id }, data: {
        cogsAmount: r2(cogs), cogsMissing: missing,
        taxAmount: r2(n.totalTaxSet?.shopMoney?.amount), refundedAmount: r2(n.totalRefundedSet?.shopMoney?.amount),
        profitSyncedAt: new Date(),
      } });
      synced++;
    }
  }
  return { synced };
}

// Profit summary for a period; refreshes orders whose Shopify data is missing or stale
export async function profitReport(admin, shop, { from, to }) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const where = { shop, shopifyCreatedAt: { gte: from, lt: to }, shopifyCancelledAt: null };
  const stale = await prisma.order.findMany({
    where: { ...where, OR: [{ profitSyncedAt: null }, { profitSyncedAt: { lt: new Date(Date.now() - 6 * 3600e3) } }] },
    take: 250, orderBy: { shopifyCreatedAt: "desc" },
  });
  const sync = admin && stale.length ? await syncOrderFinancials(admin, stale) : { synced: 0 };
  const orders = await prisma.order.findMany({ where, orderBy: { shopifyCreatedAt: "desc" }, take: 2000 });
  const rows = orders.map((o) => ({ order: o, p: computeProfit(o, settings) }));
  const sum = (k) => r2(rows.reduce((a, x) => a + x.p[k], 0));
  const revenue = sum("revenueNet");
  return {
    count: rows.length, revenue, cogs: sum("cogs"), shipping: sum("shipping") + sum("returnCost"), paymentFee: sum("paymentFee"),
    profit: sum("profit"), margin: revenue > 0 ? Math.round((sum("profit") / revenue) * 1000) / 10 : null,
    losing: rows.filter((x) => x.p.profit < 0).slice(0, 30).map((x) => ({ id: x.order.id, name: x.order.shopifyOrderName, profit: x.p.profit, reason: x.order.awbStatus === "returned" ? "returnat" : x.p.cogs === 0 ? "fără cost produse" : "cost mare" })),
    missingCosts: rows.filter((x) => x.order.cogsMissing).length,
    vatRate: storeVatRate(settings), syncError: sync.error || null,
  };
}
