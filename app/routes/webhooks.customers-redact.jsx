// app/routes/webhooks.customers-redact.jsx
// GDPR: Shopify requests deletion of a specific customer's personal data.
// We anonymise PII fields on their orders while keeping AWB records for accounting.
import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_REDACT") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const email = payload.customer?.email || "";

    // Anonymise PII — keep AWB numbers and order records for accounting/legal
    await prisma.order.updateMany({
      where: { shop, customerEmail: email },
      data: {
        customerName:     "[redacted]",
        customerPhone:    "[redacted]",
        customerEmail:    "[redacted]",
        shippingAddress1: "[redacted]",
        shippingCity:     "[redacted]",
        shippingCounty:   "[redacted]",
        shippingZip:      "[redacted]",
      },
    });

    console.log(`[GDPR] customers/redact processed for shop=${shop}`);
  } catch (err) {
    logError("[GDPR] customers/redact", err);
  }

  return new Response(null, { status: 200 });
};
