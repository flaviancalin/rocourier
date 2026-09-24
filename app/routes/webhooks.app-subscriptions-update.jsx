// app/routes/webhooks.app-subscriptions-update.jsx
// Fires when a Shopify app subscription changes status —
// including when Shopify cancels it due to a failed payment or merchant-initiated cancel.
// Keeps our DB in sync so merchants don't retain paid access after a failed charge.

import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export const loader = async () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const status = payload?.app_subscription?.status; // "ACTIVE" | "CANCELLED" | "DECLINED" | "EXPIRED" | "FROZEN" | "PENDING"

    if (status && status !== "ACTIVE" && status !== "PENDING") {
      // Subscription is no longer active — reset to trial
      await prisma.shopSettings.updateMany({
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
