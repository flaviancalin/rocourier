// app/shopify.server.js
import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server.js";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {},
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Requirement 1.2.3: on reinstall, cancel any active recurring subscription
      // so the merchant must go through billing approval again.
      // Lifetime purchases are never reset — they are non-refundable one-time charges.
      const existing = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
      if (!existing || !["pro_monthly", "pro_yearly"].includes(existing.planType)) return;

      // Query Shopify for live active subscriptions (more reliable than stored ID)
      try {
        const subsRes  = await admin.graphql(`{ currentAppInstallation { activeSubscriptions { id } } }`);
        const subsData = await subsRes.json();
        const active   = subsData.data?.currentAppInstallation?.activeSubscriptions || [];

        for (const sub of active) {
          await admin.graphql(
            `mutation appSubscriptionCancel($id: ID!) {
              appSubscriptionCancel(id: $id) {
                appSubscription { id status }
                userErrors { field message }
              }
            }`,
            { variables: { id: sub.id } }
          );
        }
      } catch (_) {}

      await prisma.shopSettings.update({
        where: { shop: session.shop },
        data:  { planType: "trial", shopifyChargeId: null, planActivatedAt: null },
      });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
