// app/routes/webhooks.app-uninstalled.jsx
// Fires when a merchant uninstalls Picklo.
// Cancels any active Shopify subscription and resets plan to trial.
// Shopify auto-cancels the subscription too, but we reset our DB immediately
// so the merchant's data is clean on potential reinstall.

import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

export const loader = async () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  if (topic !== "APP_UNINSTALLED") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    // Reset plan to trial — Shopify cancels the billing subscription on their end automatically.
    // We sync our DB so there's no stale paid plan if the merchant reinstalls later.
    await prisma.shopSettings.updateMany({
      where: { shop },
      data:  { planType: "trial", shopifyChargeId: null, planActivatedAt: null },
    });

    // Delete all app sessions for this shop so stale tokens don't accumulate.
    await prisma.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.error("[Webhook APP_UNINSTALLED] error:", err.message);
  }

  return new Response(null, { status: 200 });
};
