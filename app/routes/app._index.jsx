// app/routes/app._index.jsx
// Main Dashboard — stats overview + recent orders

import { useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { getOrders, getDashboardStats } from "../models/order.server.js";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

const LOCALE_MAP = { ro: "ro-RO", en: "en-US", de: "de-DE", hu: "hu-HU", cs: "cs-CZ" };

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url  = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");

  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });

  // If setup not done, still load dashboard data but flag for client-side navigation
  if (!settings?.onboardingCompleted) {
    return json({ orders: [], total: 0, totalPages: 0, page: 1, stats: { byStatus: {}, byCourier: {}, byMethod: {}, pendingCodTotal: 0, pendingCodCount: 0 }, setupRequired: true });
  }

  const [{ orders, total, totalPages }, stats] = await Promise.all([
    getOrders({ shop: session.shop, page, perPage: 20 }),
    getDashboardStats(session.shop),
  ]);

  return json({ orders, total, totalPages, page, stats, setupRequired: false });
}

// ─── Static courier config ───────────────────────────────────────────────────
const COURIER_CONFIG = {
  fan:     { label: "FAN Courier",  color: "#e65100" },
  sameday: { label: "Sameday",      color: "#1565c0" },
  cargus:  { label: "Cargus",       color: "#d32f2f" },
  gls:     { label: "GLS Romania",  color: "#f9a825" },
  packeta: { label: "Packeta",      color: "#e91e63" },
};

const STATUS_TONES = {
  pending:           "warning",
  generated:         "info",
  picked_up:         "info",
  in_transit:        "attention",
  out_for_delivery:  "success",
  delivered:         "success",
  returned:          "critical",
  failed:            "critical",
};

// ─── Sub-components ──────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const { t } = useTranslation();
  const tone  = STATUS_TONES[status] || "default";
  return <Badge tone={tone}>{t(`status_${status}`) || status}</Badge>;
}

function CourierBadge({ courier }) {
  const cfg = COURIER_CONFIG[courier] || { label: courier, color: "#555" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: cfg.color + "22",
      color: cfg.color,
      border: `1px solid ${cfg.color}44`,
    }}>
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e1e3e5",
      borderRadius: 12,
      padding: "20px 24px",
      borderTop: `4px solid ${accent || "#5c6ac4"}`,
      flex: 1,
      minWidth: 140,
    }}>
      <Text variant="headingXl" as="p" fontWeight="bold">{value}</Text>
      <Text variant="bodyMd" tone="subdued">{label}</Text>
      {sub && <Text variant="bodySm" tone="subdued">{sub}</Text>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { orders, stats, setupRequired } = useLoaderData();
  const navigate = useNavigate();
  const { t, lang } = useTranslation();

  useEffect(() => {
    if (setupRequired) navigate("/app/setup");
  }, [setupRequired]);

  const locale = LOCALE_MAP[lang] || "en-US";

  const totalOrders = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  const delivered   = stats.byStatus.delivered || 0;
  const inTransit   = stats.byStatus.in_transit || 0;
  const generated   = stats.byStatus.generated || 0;

  const rows = orders.map((o) => [
    <Button variant="plain" onClick={() => navigate(`/app/orders/${o.id}`)}>
      {o.shopifyOrderName}
    </Button>,
    o.customerName || "—",
    <CourierBadge courier={o.courierType} />,
    o.shippingMethod === "pickup_point"
      ? `${o.pickupPointName || t("pickup_short")}`
      : t("at_home"),
    o.awbNumber
      ? <span style={{ fontFamily: "monospace", fontSize: 13 }}>{o.awbNumber}</span>
      : <Text tone="subdued">—</Text>,
    <StatusBadge status={o.awbStatus} />,
    o.codAmount > 0
      ? <Text fontWeight="semibold">{o.codAmount.toFixed(2)} RON</Text>
      : <Text tone="subdued">—</Text>,
    new Date(o.createdAt).toLocaleDateString(locale, {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }),
  ]);

  return (
    <Page
      title={t("dashboard_title")}
      subtitle={t("dashboard_subtitle")}
      primaryAction={{
        content: t("settings"),
        onAction: () => navigate("/app/settings"),
      }}
      secondaryActions={[{
        content: t("all_orders"),
        onAction: () => navigate("/app/orders"),
      }]}
    >
      <Layout>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <Layout.Section>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <StatCard label={t("stats_total")}      value={totalOrders} accent="#5c6ac4" />
            <StatCard label={t("stats_generated")}  value={generated}   accent="#006fbb" />
            <StatCard label={t("stats_in_transit")} value={inTransit}   accent="#f49342" />
            <StatCard label={t("stats_delivered")}  value={delivered}   accent="#108043" />
            <StatCard
              label={t("stats_cod")}
              value={`${stats.pendingCodTotal.toFixed(0)} RON`}
              sub={t("stats_cod_orders", { n: stats.pendingCodCount })}
              accent="#e65100"
            />
          </div>
        </Layout.Section>

        {/* ── Courier / method split ─────────────────────────────────────── */}
        <Layout.Section>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

            {/* Courier distribution */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">{t("courier_distribution")}</Text>
                  <Divider />
                  {Object.entries(stats.byCourier).map(([courier, count]) => {
                    const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                    const cfg = COURIER_CONFIG[courier] || { label: courier, color: "#888" };
                    return (
                      <div key={courier}>
                        <InlineStack align="space-between">
                          <Text>{cfg.label}</Text>
                          <Text fontWeight="semibold">{count} ({pct}%)</Text>
                        </InlineStack>
                        <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, marginTop: 6 }}>
                          <div style={{
                            width: `${pct}%`, height: "100%",
                            background: cfg.color, borderRadius: 4,
                            transition: "width 0.5s ease",
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </BlockStack>
              </Card>
            </div>

            {/* Delivery method split */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">{t("delivery_method")}</Text>
                  <Divider />
                  {[
                    { key: "home_delivery", label: t("home_delivery_stat"), color: "#5c6ac4" },
                    { key: "pickup_point",  label: t("pickup_point_stat"),  color: "#108043" },
                  ].map(({ key, label, color }) => {
                    const count = stats.byMethod[key] || 0;
                    const pct   = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                    return (
                      <div key={key}>
                        <InlineStack align="space-between">
                          <Text>{label}</Text>
                          <Text fontWeight="semibold">{count} ({pct}%)</Text>
                        </InlineStack>
                        <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, marginTop: 6 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s" }} />
                        </div>
                      </div>
                    );
                  })}
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>

        {/* ── Recent orders table ───────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" fontWeight="semibold">{t("recent_orders")}</Text>
                <Button variant="plain" onClick={() => navigate("/app/orders")}>
                  {t("view_all")}
                </Button>
              </InlineStack>

              {orders.length === 0 ? (
                <EmptyState
                  heading={t("no_orders_yet")}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>{t("no_orders_desc")}</p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text","text","text","text","text","text","numeric","text"]}
                  headings={[
                    t("col_order"), t("col_customer"), t("col_courier"),
                    t("col_delivery"), t("col_awb"), t("col_status"),
                    t("col_cod"), t("col_date"),
                  ]}
                  rows={rows}
                  hasZebraStripingOnData
                  increasedTableDensity
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
