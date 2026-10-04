// app/routes/auth.billing-callback.jsx
// Handles Shopify billing return URL outside the embedded app context.
// Top-level browser redirects from Shopify billing cannot use authenticate.admin
// (no session token in the request), so we verify the charge directly using
// the stored offline session and then redirect to the Shopify admin root.
import { redirect } from "@remix-run/node";
import { prisma } from "../db.server.js";
import { apiVersion } from "../shopify.server.js";
import { consumeDiscountCode } from "../services/billing.server.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || apiVersion;
// Use SHOPIFY_APP_HANDLE (the "rocourier" handle), not SHOPIFY_API_KEY (hex client ID).
// Set SHOPIFY_APP_HANDLE=rocourier in Railway env vars.
const APP_HANDLE  = process.env.SHOPIFY_APP_HANDLE || "rocourier";

export async function loader({ request }) {
  const url   = new URL(request.url);
  const shop  = url.searchParams.get("shop");
  const rawId = url.searchParams.get("charge_id");
  const discountCode = (url.searchParams.get("dc") || "").trim().toUpperCase();

  let activationSucceeded = false;

  if (shop && rawId) {
    try {
      const session = await prisma.session.findFirst({
        where: { shop, isOnline: false, accessToken: { not: "" } },
        orderBy: { expires: "desc" },
      });

      if (session?.accessToken) {
        const gql  = (query, variables) => adminGraphql(shop, session.accessToken, query, variables);
        const node = await resolveCharge(gql, rawId);
        if (node && (node.status === "ACTIVE" || node.status === "ACCEPTED")) {
          const planType = inferPlan(node);
          // Store the full GID so webhooks can match it exactly
          await prisma.shopSettings.upsert({
            where:  { shop },
            create: { shop, planType, shopifyChargeId: node.id, planActivatedAt: new Date() },
            update: { planType, shopifyChargeId: node.id, planActivatedAt: new Date() },
          });
          await consumeDiscountCode(discountCode, shop);
          // Lifetime replaces any recurring plan — stop the merchant being charged twice
          if (planType === "lifetime") await cancelRecurringSubscriptions(gql);
          activationSucceeded = true;
        }
      }
    } catch (err) {
      console.error("[BillingCallback] error:", err.message);
    }
  }

  if (!shop) return redirect("/app/billing");

  // Shopify Admin maps apps/HANDLE/X → iframe at /X, so we need /app/billing not /billing
  const base = `https://${shop}/admin/apps/${APP_HANDLE}/app/billing`;
  return redirect(activationSucceeded ? `${base}?activated=1` : `${base}?billing_error=1`);
}

async function adminGraphql(shop, token, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body:    JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function resolveCharge(gql, rawId) {
  const query = async (gid) => {
    const fragment = gid.includes("AppPurchaseOneTime")
      ? `... on AppPurchaseOneTime { id status name }`
      : `... on AppSubscription { id status name }`;
    const body = await gql(`query ($id: ID!) { node(id: $id) { ${fragment} } }`, { id: gid });
    const node = body?.data?.node;
    return node?.status ? node : null;
  };

  if (rawId.startsWith("gid://")) return query(rawId);

  // Shopify appends plain numeric charge IDs to return URLs — try both types
  return (
    (await query(`gid://shopify/AppSubscription/${rawId}`)) ||
    (await query(`gid://shopify/AppPurchaseOneTime/${rawId}`))
  );
}

async function cancelRecurringSubscriptions(gql) {
  try {
    const data   = await gql(`{ currentAppInstallation { activeSubscriptions { id } } }`);
    const active = data?.data?.currentAppInstallation?.activeSubscriptions || [];
    for (const sub of active) {
      const res = await gql(
        `mutation ($id: ID!) { appSubscriptionCancel(id: $id) { userErrors { field message } } }`,
        { id: sub.id }
      );
      const errors = res?.data?.appSubscriptionCancel?.userErrors || [];
      if (errors.length) console.error("[BillingCallback] cancel userErrors:", errors);
    }
  } catch (err) {
    console.error("[BillingCallback] cancel recurring failed:", err.message);
  }
}

function inferPlan(node) {
  if (node.id?.includes("AppPurchaseOneTime")) return "lifetime";
  if (node.name?.includes("Yearly"))           return "pro_yearly";
  return "pro_monthly";
}
