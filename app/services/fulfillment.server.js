// app/services/fulfillment.server.js
// Shopify fulfillment + order metadata writes — GraphQL Admin API only.

export const COURIER_TRACKING = {
  fan:     { company: "FAN Courier", url: (awb) => `https://www.fancourier.ro/awb-tracking/?awb=${awb}` },
  sameday: { company: "Sameday",     url: (awb) => `https://sameday.ro/awb/?awb=${awb}` },
  cargus:  { company: "Cargus",      url: (awb) => `https://urgentcargus.ro/tracking/${awb}` },
  gls:     { company: "GLS Romania", url: (awb) => `https://gls-group.com/RO/en/parcel-tracking/?match=${awb}` },
  packeta: { company: "Packeta",     url: (awb) => `https://tracking.packeta.com/?id=${awb}` },
  dpd:     { company: "DPD",         url: (awb) => `https://tracking.dpd.ro/?shipmentNumber=${awb}&language=ro` },
};

export function trackingFor(courierType, awbNumber) {
  const t = COURIER_TRACKING[courierType];
  return { company: t?.company || courierType, number: awbNumber, url: t ? t.url(awbNumber) : undefined };
}

export const orderGid = (id) => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`);

const FULFILLMENT_ORDERS_QUERY = `
  query GetFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      customAttributes { key value }
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          lineItems(first: 50) { nodes { id remainingQuantity } }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  return res.json();
}

// Fulfills every open line item of the order with the AWB as tracking.
// Returns { fulfillmentId } on success or { error } — never throws for business errors.
export async function fulfillOrderWithTracking(admin, { shopifyOrderId, courierType, awbNumber, notifyCustomer = false }) {
  const body = await gql(admin, FULFILLMENT_ORDERS_QUERY, { orderId: orderGid(shopifyOrderId) });
  if (body?.errors?.length) return { error: body.errors.map((e) => e.message).join("; ") };

  const openFOs = (body?.data?.order?.fulfillmentOrders?.nodes || [])
    .filter((fo) => ["OPEN", "IN_PROGRESS"].includes(fo.status));
  if (!openFOs.length) return { error: "Already fulfilled or no open fulfillment orders" };

  const lineItemsByFulfillmentOrder = openFOs
    .map((fo) => {
      const items = (fo.lineItems?.nodes || []).filter((li) => li.remainingQuantity > 0);
      return items.length
        ? { fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: items.map((li) => ({ id: li.id, quantity: li.remainingQuantity })) }
        : null;
    })
    .filter(Boolean);
  if (!lineItemsByFulfillmentOrder.length) return { error: "No fulfillable items" };

  const result = await gql(admin, FULFILLMENT_CREATE_MUTATION, {
    fulfillment: {
      lineItemsByFulfillmentOrder,
      trackingInfo: trackingFor(courierType, awbNumber),
      notifyCustomer,
    },
  });
  if (result?.errors?.length) return { error: result.errors.map((e) => e.message).join("; ") };
  const payload = result?.data?.fulfillmentCreate;
  if (payload?.userErrors?.length) return { error: payload.userErrors.map((e) => e.message).join("; ") };
  return { fulfillmentId: payload?.fulfillment?.id };
}

// Merges attributes into the order's existing custom attributes (never drops the buyer's).
export async function mergeOrderAttributes(admin, shopifyOrderId, attrs) {
  const id   = orderGid(shopifyOrderId);
  const body = await gql(admin, `query ($id: ID!) { order(id: $id) { customAttributes { key value } } }`, { id });
  const existing = body?.data?.order?.customAttributes || [];
  const merged   = new Map(existing.map((a) => [a.key, a.value ?? ""]));
  for (const [key, value] of Object.entries(attrs)) merged.set(key, value ?? "");

  const res = await gql(admin, `
    mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) { order { id } userErrors { field message } }
    }`, { input: { id, customAttributes: [...merged].map(([key, value]) => ({ key, value })) } });
  const errors = res?.data?.orderUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

export async function setOrderMetafields(admin, shopifyOrderId, namespace, values) {
  const ownerId = orderGid(shopifyOrderId);
  const metafields = Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, value]) => ({ ownerId, namespace, key, value: String(value), type: "single_line_text_field" }));
  if (!metafields.length) return;

  const res = await gql(admin, `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`, { metafields });
  const errors = res?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

// Cancels the order's fulfillments that carry this AWB as tracking (after the AWB is deleted).
export async function cancelFulfillmentsForAwb(admin, shopifyOrderId, awbNumber) {
  if (!awbNumber) return 0;
  const body = await gql(admin, `query ($id: ID!) { order(id: $id) { fulfillments { id status trackingInfo { number } } } }`,
    { id: orderGid(shopifyOrderId) });
  const matches = (body?.data?.order?.fulfillments || []).filter((f) =>
    f.status === "SUCCESS" && f.trackingInfo.some((t) => t.number === awbNumber));
  for (const f of matches) {
    const res = await gql(admin, `mutation ($id: ID!) { fulfillmentCancel(id: $id) { userErrors { message } } }`, { id: f.id });
    const errors = res?.data?.fulfillmentCancel?.userErrors || [];
    if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  }
  return matches.length;
}
