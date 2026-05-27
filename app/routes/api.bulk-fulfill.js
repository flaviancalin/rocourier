// app/routes/api.bulk-fulfill.js
// Marks multiple orders as fulfilled in Shopify with their AWB tracking info
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const COURIER_TRACKING = {
  fan:     { company: "FAN Courier",    url: (awb) => `https://www.fancourier.ro/awb-tracking/?awb=${awb}` },
  sameday: { company: "Sameday",        url: (awb) => `https://sameday.ro/awb/?awb=${awb}` },
  cargus:  { company: "Cargus",         url: (awb) => `https://urgentcargus.ro/tracking/${awb}` },
  gls:     { company: "GLS Romania",    url: (awb) => `https://gls-group.com/RO/en/parcel-tracking/?match=${awb}` },
  packeta: { company: "Packeta",        url: (awb) => `https://tracking.packeta.com/?id=${awb}` },
};

const FULFILLMENT_ORDERS_QUERY = `
  query GetFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          lineItems(first: 50) {
            nodes {
              id
              remainingQuantity
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const { orderIds } = await request.json();
  if (!Array.isArray(orderIds) || !orderIds.length) {
    return json({ error: "No orderIds provided" }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { shop, id: { in: orderIds }, awbNumber: { not: null } },
  });

  const results = [];

  for (const order of orders) {
    try {
      const tracking = COURIER_TRACKING[order.courierType] || {
        company: order.courierType,
        url: () => "",
      };

      // Get fulfillment orders via GraphQL Admin API
      const orderId = `gid://shopify/Order/${order.shopifyOrderId}`;
      const foRes  = await admin.graphql(FULFILLMENT_ORDERS_QUERY, { variables: { orderId } });
      const foBody = await foRes.json();
      const fulfillmentOrders = foBody?.data?.order?.fulfillmentOrders?.nodes || [];

      // Only pick OPEN or IN_PROGRESS fulfillment orders
      const openFOs = fulfillmentOrders.filter((fo) =>
        ["OPEN", "IN_PROGRESS"].includes(fo.status)
      );

      if (!openFOs.length) {
        results.push({
          orderId: order.id,
          orderName: order.shopifyOrderName,
          success: false,
          error: "Already fulfilled or no open fulfillment orders",
        });
        continue;
      }

      const lineItemsByFulfillmentOrder = openFOs
        .map((fo) => {
          const items = (fo.lineItems?.nodes || []).filter((li) => li.remainingQuantity > 0);
          if (!items.length) return null;
          return {
            fulfillmentOrderId: fo.id,
            fulfillmentOrderLineItems: items.map((li) => ({
              id: li.id,
              quantity: li.remainingQuantity,
            })),
          };
        })
        .filter(Boolean);

      if (!lineItemsByFulfillmentOrder.length) {
        results.push({
          orderId: order.id,
          orderName: order.shopifyOrderName,
          success: false,
          error: "No fulfillable items",
        });
        continue;
      }

      const fulfillRes  = await admin.graphql(FULFILLMENT_CREATE_MUTATION, {
        variables: {
          fulfillment: {
            lineItemsByFulfillmentOrder,
            trackingInfo: {
              company: tracking.company,
              number:  order.awbNumber,
              url:     tracking.url(order.awbNumber),
            },
            notifyCustomer: false,
          },
        },
      });
      const fulfillBody = await fulfillRes.json();
      const result      = fulfillBody?.data?.fulfillmentCreateV2;

      if (result?.userErrors?.length) {
        const errMsg = result.userErrors.map((e) => e.message).join("; ");
        results.push({
          orderId: order.id,
          orderName: order.shopifyOrderName,
          success: false,
          error: errMsg,
        });
        continue;
      }

      results.push({
        orderId:       order.id,
        orderName:     order.shopifyOrderName,
        success:       true,
        fulfillmentId: result?.fulfillment?.id,
      });
    } catch (e) {
      results.push({
        orderId:   order.id,
        orderName: order.shopifyOrderName,
        success:   false,
        error:     e.message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;

  return json({ results, succeeded, failed });
}
