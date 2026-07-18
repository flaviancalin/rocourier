// app/routes/api.carrier-setup.js
// Registers (or checks) our carrier service with Shopify.
// Called from the Settings page by the merchant.
//
// NOTE: Shopify's carrier_services resource has no equivalent in the Admin GraphQL API.
// The REST endpoint is the only supported way to register callback-based carrier services
// (rate-calculation callbacks). This is a documented Shopify exception — see:
// https://shopify.dev/docs/api/admin-rest/latest/resources/carrierservice

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
const API_VERSION = "2025-01";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop, accessToken } = session;
  const body = await request.json().catch(() => ({}));
  const intent = body.intent || "register";

  const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" };

  const listRes = await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services.json`, { headers });
  const listData = await listRes.json();
  const existing = listData.carrier_services || [];
  const ours = existing.find((cs) => cs.callback_url === CALLBACK_URL);

  if (intent === "check") {
    return json({ registered: !!ours, id: ours?.id || null, all: existing });
  }

  if (intent === "register") {
    if (ours) return json({ success: true, alreadyRegistered: true, id: ours.id });

    const createRes = await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ carrier_service: { name: "Picklo", callback_url: CALLBACK_URL, service_discovery: true } }),
    });
    const createData = await createRes.json();
    const cs = createData.carrier_service;
    if (cs?.id) return json({ success: true, id: cs.id });
    return json({ success: false, error: JSON.stringify(createData) }, { status: 500 });
  }

  if (intent === "unregister") {
    if (!ours) return json({ success: true, wasNotRegistered: true });
    await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services/${ours.id}.json`, { method: "DELETE", headers });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}
