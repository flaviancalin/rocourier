// app/routes/webhooks.app-subscriptions-update.jsx
// Fires whenever any of the shop's app subscriptions changes status.
// Only the subscription we currently consider active may downgrade the shop —
// events for a replaced plan (monthly → yearly) or a declined upgrade are ignored.

import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { sameCharge, planTypeFromSubscriptionName } from "../services/billing.server.js";

export const loader = async () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const sub    = payload?.app_subscription || {};
    const status = sub.status; // ACTIVE | CANCELLED | DECLINED | EXPIRED | FROZEN | PENDING
    const subId  = sub.admin_graphql_api_id;
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (status === "ACTIVE") {
      // Covers merchants who approve the charge but never land on the billing callback
      if (settings?.planType === "lifetime") return new Response(null, { status: 200 });
      const planType = planTypeFromSubscriptionName(sub.name);
      await prisma.shopSettings.upsert({
        where:  { shop },
        create: { shop, planType, shopifyChargeId: subId, planActivatedAt: new Date() },
        update: { planType, shopifyChargeId: subId, ...(sameCharge(settings?.shopifyChargeId, subId) ? {} : { planActivatedAt: new Date() }) },
      });
    } else if (status && status !== "PENDING" && settings && sameCharge(settings.shopifyChargeId, subId)) {
      await prisma.shopSettings.update({
        where: { shop },
        data:  { planType: "trial", shopifyChargeId: null, planActivatedAt: null },
      });
      console.log(`[APP_SUBSCRIPTIONS_UPDATE] ${shop} subscription ${status} — reset to trial`);
    }
  } catch (err) {
    console.error("[Webhook APP_SUBSCRIPTIONS_UPDATE] error:", err.message);
  }

  return new Response(null, { status: 200 });
};
