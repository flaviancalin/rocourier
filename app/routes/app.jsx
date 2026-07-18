// app/routes/app.jsx
// This is the parent layout for all admin pages.
// Every route starting with app. will render inside this layout.

import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server.js";
import { I18nProvider, useTranslation } from "../context/i18n.jsx";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const isAdmin = session.shop === (process.env.ADMIN_SHOP || "courier-store-2.myshopify.com");
  return json({ apiKey: process.env.SHOPIFY_API_KEY ?? "", isAdmin });
}

function AppLayout() {
  const { apiKey, isAdmin } = useLoaderData();
  const { t } = useTranslation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Shopify admin navigation sidebar */}
      <NavMenu>
        <Link to="/app" rel="home">{t("nav_dashboard")}</Link>
        <Link to="/app/orders">{t("nav_orders")}</Link>
        <Link to="/app/settings">{t("nav_settings")}</Link>
        <Link to="/app/pickup-points">{t("nav_pickup_points")}</Link>
        <Link to="/app/widget">{t("nav_widget")}</Link>
        <Link to="/app/billing">{t("nav_billing")}</Link>
        {isAdmin && <Link to="/app/admin-codes">{t("nav_admin_codes")}</Link>}
      </NavMenu>

      <Outlet />
    </AppProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppLayout />
    </I18nProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
