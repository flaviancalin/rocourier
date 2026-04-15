// app/routes/webhooks.customers-data-request.jsx
// GDPR: Shopify asks what data we hold about a specific customer.
// Required for App Store listing.
import { authenticate } from "../shopify.server.js";
import { logError } from "../utils/log.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_DATA_REQUEST") {
    return new Response("Unhandled topic", { status: 200 });
  }

  try {
    const customerId = String(payload.customer?.id || "");
    const email = payload.customer?.email || "";

    // Find any orders we hold for this customer
    const orders = await prisma.order.findMany({
      where: {
        shop,
        OR: [
          { customerEmail: email },
          ...(customerId ? [{ shopifyOrderId: { contains: customerId } }] : []),
        ],
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        shippingAddress1: true,
        shippingCity: true,
        shippingCounty: true,
        shippingZip: true,
        awbNumber: true,
        createdAt: true,
      },
    });

    // Log the data request for audit purposes (no PII in the log)
    console.log(`[GDPR] data_request for shop=${shop} customer=${customerId} orders=${orders.length}`);
  } catch (err) {
    logError("[GDPR] customers/data_request", err);
  }

  return new Response(null, { status: 200 });
};
