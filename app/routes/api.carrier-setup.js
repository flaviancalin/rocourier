// app/routes/api.carrier-setup.js
// Registers (or checks) our carrier service with Shopify.
// Called from the Settings page by the merchant.

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const CALLBACK_URL = `${APP_URL}/carrier-service`;

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  const intent = body.intent || "register";

  if (intent === "check") {
    // List existing carrier services
    const res = await admin.rest.get({ path: "carrier_services" });
    const existing = res.body?.carrier_services || [];
    const ours = existing.find((cs) => cs.callback_url === CALLBACK_URL);
    return json({ registered: !!ours, id: ours?.id || null, all: existing });
  }

  if (intent === "register") {
    // Check if already registered
    const checkRes = await admin.rest.get({ path: "carrier_services" });
    const existing = checkRes.body?.carrier_services || [];
    const ours = existing.find((cs) => cs.callback_url === CALLBACK_URL);

    if (ours) {
      return json({ success: true, alreadyRegistered: true, id: ours.id });
    }

    // Register new
    const createRes = await admin.rest.post({
      path: "carrier_services",
      data: {
        carrier_service: {
          name: "RoCourier",
          callback_url: CALLBACK_URL,
          service_discovery: true,
        },
      },
    });

    const cs = createRes.body?.carrier_service;
    if (cs?.id) {
      return json({ success: true, id: cs.id });
    }

    return json({ success: false, error: JSON.stringify(createRes.body) }, { status: 500 });
  }

  if (intent === "unregister") {
    const checkRes = await admin.rest.get({ path: "carrier_services" });
    const existing = checkRes.body?.carrier_services || [];
    const ours = existing.find((cs) => cs.callback_url === CALLBACK_URL);

    if (!ours) return json({ success: true, wasNotRegistered: true });

    await admin.rest.delete({ path: `carrier_services/${ours.id}` });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}
