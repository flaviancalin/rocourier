// app/services/shopify-orders.server.js
// Order-level actions in Shopify used by Picklo's automations (GraphQL Admin API).

const gid = (id) => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`);

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

// Cancels the order with restock. Refunds only go to the original payment method
// (App Store rule 1.1.15); an unpaid cash-on-delivery order simply has nothing to refund.
export async function cancelShopifyOrder(admin, shopifyOrderId, { staffNote, notifyCustomer = false } = {}) {
  const data = await gql(admin, `
    mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $refundMethod: OrderCancelRefundMethodInput, $notifyCustomer: Boolean, $staffNote: String) {
      orderCancel(orderId: $orderId, reason: $reason, restock: $restock, refundMethod: $refundMethod, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        job { id } orderCancelUserErrors { message }
      }
    }`, {
    orderId: gid(shopifyOrderId), reason: "DECLINED", restock: true,
    refundMethod: { originalPaymentMethodsRefund: true }, notifyCustomer, staffNote: staffNote || null,
  });
  const errors = data.orderCancel.orderCancelUserErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

export async function markShopifyOrderPaid(admin, shopifyOrderId) {
  const data = await gql(admin, `
    mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) { userErrors { message } }
    }`, { input: { id: gid(shopifyOrderId) } });
  const errors = data.orderMarkAsPaid.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

const STATUS_TAGS = {
  generated: "picklo-awb", picked_up: "picklo-in-tranzit", in_transit: "picklo-in-tranzit",
  out_for_delivery: "picklo-in-livrare", delivered: "picklo-livrat", returned: "picklo-retur", failed: "picklo-esuat",
  cancelled: "picklo-anulat",
};
const ALL_STATUS_TAGS = [...new Set(Object.values(STATUS_TAGS))];

// Keeps exactly one picklo-* status tag on the order
export async function setStatusTag(admin, shopifyOrderId, status) {
  const tag = STATUS_TAGS[status];
  if (!tag) return;
  const id = gid(shopifyOrderId);
  const stale = ALL_STATUS_TAGS.filter((t) => t !== tag);
  await gql(admin, `mutation tagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { id, tags: stale });
  await gql(admin, `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id, tags: [tag] });
}

// Fills a missing shipping phone from the billing address or customer profile.
// Returns the phone now on the shipping address (or null).
export async function copyCustomerPhoneToShipping(admin, shopifyOrderId) {
  const data = await gql(admin, `
    query OrderPhones($id: ID!) { order(id: $id) {
      phone billingAddress { phone } customer { defaultPhoneNumber { phoneNumber } }
      shippingAddress { firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone } } }`,
  { id: gid(shopifyOrderId) });
  const o = data.order;
  if (!o?.shippingAddress) return null;
  if (o.shippingAddress.phone) return o.shippingAddress.phone;
  const phone = o.billingAddress?.phone || o.phone || o.customer?.defaultPhoneNumber?.phoneNumber;
  if (!phone) return null;
  // Send the whole address: a partial shippingAddress must not wipe the other fields
  const a = o.shippingAddress;
  const address = { firstName: a.firstName, lastName: a.lastName, company: a.company, address1: a.address1, address2: a.address2,
    city: a.city, provinceCode: a.provinceCode, countryCode: a.countryCodeV2, zip: a.zip, phone };
  const res = await gql(admin, `
    mutation SetShippingPhone($input: OrderInput!) { orderUpdate(input: $input) { userErrors { message } } }`,
  { input: { id: gid(shopifyOrderId), shippingAddress: address } });
  if (res.orderUpdate.userErrors.length) throw new Error(res.orderUpdate.userErrors.map((e) => e.message).join("; "));
  return phone;
}
