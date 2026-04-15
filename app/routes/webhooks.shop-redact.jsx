// app/routes/webhooks.shop-redact.jsx
// GDPR: Shop has uninstalled the app and 48h have passed — delete all shop data.
import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  if (topic !== "SHOP_REDACT") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    // Delete all data for this shop in dependency order
    await prisma.awbEvent.deleteMany({ where: { order: { shop } } });
    await prisma.order.deleteMany({ where: { shop } });
    await prisma.shopSettings.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });

    console.log(`[GDPR] shop/redact completed for shop=${shop}`);
  } catch (err) {
    logError("[GDPR] shop/redact", err);
  }

  return new Response(null, { status: 200 });
};
