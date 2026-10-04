// app/routes/webhooks.app-uninstalled.jsx
// Fires when a merchant uninstalls Picklo.
// Resets recurring plans to trial (Lifetime purchases are kept).
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
    // Reset recurring plans to trial — Shopify cancels the subscription automatically,
    // so a reinstall must go through charge approval again. Lifetime is a one-time
    // purchase the merchant already paid for, so it survives a reinstall.
    await prisma.shopSettings.updateMany({
      where: { shop, NOT: { planType: "lifetime" } },
      data:  { planType: "trial", shopifyChargeId: null, planActivatedAt: null },
    });

    // Delete all app sessions for this shop so stale tokens don't accumulate.
    await prisma.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.error("[Webhook APP_UNINSTALLED] error:", err.message);
  }

  return new Response(null, { status: 200 });
};
