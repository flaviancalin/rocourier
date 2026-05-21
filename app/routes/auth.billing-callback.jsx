// app/routes/auth.billing-callback.jsx
// Handles Shopify billing return URL outside the embedded app context.
// Top-level browser redirects from Shopify billing cannot use authenticate.admin
// (no session token in the request), so we verify the charge directly using
// the stored offline session and then redirect to the Shopify admin root.
import { redirect } from "@remix-run/node";
import { prisma } from "../db.server.js";

const API_VERSION = "2025-01";
const APP_HANDLE  = process.env.SHOPIFY_API_KEY || "rocourier";

export async function loader({ request }) {
  const url   = new URL(request.url);
  const shop  = url.searchParams.get("shop");
  const rawId = url.searchParams.get("charge_id");

  if (shop && rawId) {
    try {
      const session = await prisma.session.findFirst({
        where: { shop, isOnline: false, accessToken: { not: "" } },
        orderBy: { expires: "desc" },
      });

      if (session?.accessToken) {
        const node = await resolveCharge(shop, session.accessToken, rawId);
        if (node && (node.status === "ACTIVE" || node.status === "ACCEPTED")) {
          const planType = inferPlan(node);
          await prisma.shopSettings.upsert({
            where:  { shop },
            create: { shop, planType, shopifyChargeId: rawId, planActivatedAt: new Date() },
            update: { planType, shopifyChargeId: rawId, planActivatedAt: new Date() },
          });
        }
      }
    } catch (err) {
      console.error("[BillingCallback] error:", err.message);
    }
  }

  // Redirect to the embedded app root — no charge_id forwarded, no subpath.
  // Shopify admin will load the embedded app in the iframe normally.
  const dest = shop
    ? `https://${shop}/admin/apps/${APP_HANDLE}`
    : "/app/billing";
  return redirect(dest);
}

async function resolveCharge(shop, token, rawId) {
  const query = async (gid) => {
    const isOneTime = gid.includes("AppPurchaseOneTime");
    const fragment  = isOneTime
      ? `... on AppPurchaseOneTime { id status name }`
      : `... on AppSubscription { id status name }`;
    const res  = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body:    JSON.stringify({ query: `query { node(id: "${gid}") { ${fragment} } }` }),
    });
    const body = await res.json();
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

function inferPlan(node) {
  if (node.id?.includes("AppPurchaseOneTime")) return "lifetime";
  if (node.name?.includes("Yearly"))           return "pro_yearly";
  return "pro_monthly";
}
