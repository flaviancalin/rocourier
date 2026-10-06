// app/shopify.server.js
import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server.js";
import { syncPlanWithShopify } from "./services/billing.server.js";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {},
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Sync our plan with Shopify's live billing state (install, reinstall, re-auth).
      // Shopify cancels recurring subscriptions on uninstall, so a reinstalling
      // merchant lands back on trial and must approve a new charge. Nothing is cancelled here.
      try {
        await syncPlanWithShopify(session.shop, async (q, variables) => (await admin.graphql(q, { variables })).json());
      } catch (e) {
        console.error("[afterAuth] plan sync failed:", e.message);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
// A malformed `host` param makes the library throw TypeError: Invalid URL (500).
// Answer such requests with 400 instead.
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request) => {
    try {
      return await shopify.authenticate.admin(request);
    } catch (e) {
      if (e?.code === "ERR_INVALID_URL") throw new Response("Bad Request", { status: 400 });
      throw e;
    }
  },
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
