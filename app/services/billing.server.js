// app/services/billing.server.js
// Shared billing helpers used by the billing page, billing callback,
// app_subscriptions/update webhook and afterAuth hook.
import { prisma } from "../db.server.js";

export { PLANS } from "../utils/plans.js";

export const RECURRING_PLANS = ["pro_monthly", "pro_yearly"];

// "gid://shopify/AppSubscription/123" | "123" → "123"
export function chargeNumericId(id) {
  if (!id) return null;
  const s = String(id);
  return s.includes("/") ? s.split("/").pop() : s;
}

export function sameCharge(a, b) {
  const na = chargeNumericId(a);
  return !!na && na === chargeNumericId(b);
}

export function planTypeFromSubscriptionName(name = "") {
  return name.includes("Yearly") ? "pro_yearly" : "pro_monthly";
}

// Brings our DB in line with the shop's live recurring subscription.
// Lifetime (one-time purchase or gift code) is never touched here.
// `graphql` is a function (query, variables) => parsed JSON body.
export async function syncPlanWithShopify(shop, graphql) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (settings?.planType === "lifetime") return settings;

  const data   = await graphql(`{ currentAppInstallation { activeSubscriptions { id name status } } }`);
  const active = (data?.data?.currentAppInstallation?.activeSubscriptions || [])
    .find((s) => s.status === "ACTIVE");

  if (active) {
    const planType = planTypeFromSubscriptionName(active.name);
    if (settings?.planType === planType && sameCharge(settings.shopifyChargeId, active.id)) return settings;
    return prisma.shopSettings.upsert({
      where:  { shop },
      create: { shop, planType, shopifyChargeId: active.id, planActivatedAt: new Date() },
      update: { planType, shopifyChargeId: active.id, ...(settings?.planType === planType ? {} : { planActivatedAt: new Date() }) },
    });
  }

  if (settings && RECURRING_PLANS.includes(settings.planType)) {
    return prisma.shopSettings.update({
      where: { shop },
      data:  { planType: "trial", shopifyChargeId: null, planActivatedAt: null },
    });
  }
  return settings;
}

// Records a discount code as used — only called once the charge is approved.
export async function consumeDiscountCode(code, shop) {
  if (!code) return;
  try {
    await prisma.$transaction([
      prisma.discountCodeUsage.create({ data: { code, shop } }),
      prisma.discountCode.update({ where: { code }, data: { usedCount: { increment: 1 } } }),
    ]);
  } catch (e) {
    // Unique violation = already recorded (e.g. callback reloaded) — safe to ignore
    if (e?.code !== "P2002") console.error("[Billing] consumeDiscountCode:", e.message);
  }
}
