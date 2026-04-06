// app/routes/app._index.jsx
// Main Dashboard — stats overview + recent orders

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
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
  Box,
  Divider,
  EmptyState,
  Spinner,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");

  const [{ orders, total, totalPages }, stats] = await Promise.all([
    getOrders({ shop: session.shop, page, perPage: 20 }),
    getDashboardStats(session.shop),
  ]);

  return json({ orders, total, totalPages, page, stats });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending:           { label: "În așteptare",     tone: "warning" },
  generated:         { label: "AWB generat",       tone: "info" },
  picked_up:         { label: "Preluat curier",    tone: "info" },
  in_transit:        { label: "În tranzit",        tone: "attention" },
  out_for_delivery:  { label: "La livrare",        tone: "success" },
  delivered:         { label: "Livrat",            tone: "success" },
  returned:          { label: "Retur",             tone: "critical" },
  failed:            { label: "Eșuat",             tone: "critical" },
};

const COURIER_CONFIG = {
  fan:     { label: "FAN Courier", color: "#e65100" },
  sameday: { label: "Sameday",     color: "#1565c0" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, tone: "default" };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
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

// Stat card component
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
  const { orders, total, totalPages, page, stats } = useLoaderData();
  const navigate = useNavigate();

  const totalOrders = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  const delivered   = stats.byStatus.delivered || 0;
  const inTransit   = stats.byStatus.in_transit || 0;
  const pending     = stats.byStatus.pending || 0;
  const generated   = stats.byStatus.generated || 0;

  // Table rows
  const rows = orders.map((o) => [
    <Button variant="plain" onClick={() => navigate(`/app/orders/${o.id}`)}>
      {o.shopifyOrderName}
    </Button>,
    o.customerName || "—",
    <CourierBadge courier={o.courierType} />,
    o.shippingMethod === "pickup_point"
      ? `📦 ${o.pickupPointName || "Punct fix"}`
      : "🚚 Acasă",
    o.awbNumber
      ? <span style={{ fontFamily: "monospace", fontSize: 13 }}>{o.awbNumber}</span>
      : <Text tone="subdued">—</Text>,
    <StatusBadge status={o.awbStatus} />,
    o.codAmount > 0
      ? <Text fontWeight="semibold">{o.codAmount.toFixed(2)} RON</Text>
      : <Text tone="subdued">—</Text>,
    new Date(o.createdAt).toLocaleDateString("ro-RO", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }),
  ]);

  return (
    <Page
      title="🚚 Picklo Dashboard"
      subtitle="Gestionează coletele tale FAN Courier & Sameday"
      primaryAction={{
        content: "Setări",
        onAction: () => navigate("/app/settings"),
      }}
      secondaryActions={[{
        content: "Toate comenzile",
        onAction: () => navigate("/app/orders"),
      }]}
    >
      <Layout>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <Layout.Section>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <StatCard label="Total comenzi" value={totalOrders} accent="#5c6ac4" />
            <StatCard label="AWB generat" value={generated} accent="#006fbb" />
            <StatCard label="În tranzit" value={inTransit} accent="#f49342" />
            <StatCard label="Livrate" value={delivered} accent="#108043" />
            <StatCard
              label="Ramburs necolectat"
              value={`${stats.pendingCodTotal.toFixed(0)} RON`}
              sub={`${stats.pendingCodCount} comenzi`}
              accent="#e65100"
            />
          </div>
        </Layout.Section>

        {/* ── Courier split ─────────────────────────────────────────────── */}
        <Layout.Section>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {/* Courier distribution */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Distribuție curier</Text>
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
                        <div style={{
                          height: 8, background: "#f0f0f0", borderRadius: 4, marginTop: 6,
                        }}>
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
                  <Text variant="headingMd" fontWeight="semibold">Metodă livrare</Text>
                  <Divider />
                  {[
                    { key: "home_delivery", label: "🚚 Livrare la adresă", color: "#5c6ac4" },
                    { key: "pickup_point", label: "📦 Punct de ridicare", color: "#108043" },
                  ].map(({ key, label, color }) => {
                    const count = stats.byMethod[key] || 0;
                    const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
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
                <Text variant="headingMd" fontWeight="semibold">Comenzi recente</Text>
                <Button variant="plain" onClick={() => navigate("/app/orders")}>
                  Vezi toate →
                </Button>
              </InlineStack>

              {orders.length === 0 ? (
                <EmptyState
                  heading="Nicio comandă încă"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Comenzile vor apărea automat după ce clienții plasează comenzi în magazin.</p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text","text","text","text","text","text","numeric","text"]}
                  headings={["Comandă","Client","Curier","Livrare","AWB","Status","Ramburs","Dată"]}
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
