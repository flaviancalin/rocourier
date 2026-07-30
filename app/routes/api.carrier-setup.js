// app/routes/api.carrier-setup.js
// Registers (or checks) our carrier service with Shopify via Admin GraphQL API.

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  const intent = body.intent || "register";

  // List all carrier services via GraphQL
  const listRes  = await admin.graphql(`{ deliveryCarrierServices(first: 50) { nodes { id name callbackUrl } } }`);
  const listData = await listRes.json();
  const existing = listData.data?.deliveryCarrierServices?.nodes || [];
  const ours     = existing.find((cs) => cs.callbackUrl === CALLBACK_URL);

  if (intent === "check") {
    return json({ registered: !!ours, id: ours?.id || null });
  }

  if (intent === "register") {
    if (ours) return json({ success: true, alreadyRegistered: true, id: ours.id });

    const createRes  = await admin.graphql(
      `mutation deliveryCarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
        deliveryCarrierServiceCreate(input: $input) {
          carrierService { id name callbackUrl }
          userErrors { field message }
        }
      }`,
      { variables: { input: { name: "Picklo", callbackUrl: CALLBACK_URL, supportsServiceDiscovery: true } } }
    );
    const createData = await createRes.json();
    const cs         = createData.data?.deliveryCarrierServiceCreate?.carrierService;
    const errors     = createData.data?.deliveryCarrierServiceCreate?.userErrors || [];
    if (cs?.id) return json({ success: true, id: cs.id });
    return json({ success: false, error: errors[0]?.message || JSON.stringify(createData) }, { status: 500 });
  }

  if (intent === "unregister") {
    if (!ours) return json({ success: true, wasNotRegistered: true });

    const delRes  = await admin.graphql(
      `mutation deliveryCarrierServiceDelete($id: ID!) {
        deliveryCarrierServiceDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
      { variables: { id: ours.id } }
    );
    const delData = await delRes.json();
    const delErrors = delData.data?.deliveryCarrierServiceDelete?.userErrors || [];
    if (delErrors.length) return json({ success: false, error: delErrors[0]?.message }, { status: 500 });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}
