// app/routes/app.orders.$id.jsx
// Single order detail — view info, generate AWB, track parcel

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { getOrder } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, Divider, Timeline, Box, Banner, Modal, Select,
  TextField, Spinner, Toast, Frame,
} from "@shopify/polaris";

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const order = await getOrder(session.shop, params.id);
  if (!order) throw new Response("Not found", { status: 404 });

  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
    select: { fanEnabled: true, samedayEnabled: true },
  });

  return json({ order, settings });
}

const STATUS_MAP = {
  pending:          { label: "În așteptare",    tone: "warning",  icon: "⏳" },
  generated:        { label: "AWB generat",     tone: "info",     icon: "🏷️" },
  picked_up:        { label: "Preluat curier",  tone: "info",     icon: "📤" },
  in_transit:       { label: "În tranzit",      tone: "attention",icon: "🚚" },
  out_for_delivery: { label: "La livrare",      tone: "success",  icon: "🏠" },
  delivered:        { label: "Livrat",          tone: "success",  icon: "✅" },
  returned:         { label: "Retur",           tone: "critical", icon: "↩️" },
  failed:           { label: "Eșuat",           tone: "critical", icon: "❌" },
};

export default function OrderDetail() {
  const { order, settings } = useLoaderData();
  const navigate = useNavigate();

  const [generating, setGenerating]   = useState(false);
  const [tracking, setTracking]       = useState(false);
  const [trackEvents, setTrackEvents] = useState(order.events || []);
  const [modalOpen, setModalOpen]     = useState(false);
  const [weight, setWeight]           = useState(String(order.weight || 1));
  const [courier, setCourier]         = useState(order.courierType);
  const [toast, setToast]             = useState(null);
  const [error, setError]             = useState(null);

  const statusCfg = STATUS_MAP[order.awbStatus] || { label: order.awbStatus, tone: "default", icon: "📦" };

  // ── Generate AWB ───────────────────────────────────────────────────────────
  async function handleGenerateAwb() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          courierOverride: courier,
          weightOverride: parseFloat(weight),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToast(`AWB generat: ${data.awbNumber}`);
        setModalOpen(false);
        setTimeout(() => navigate(`/app/orders/${order.id}`, { replace: true }), 1000);
      } else {
        setError(data.error || "AWB generation failed");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  // ── Track AWB ──────────────────────────────────────────────────────────────
  async function handleTrackAwb() {
    if (!order.awbNumber) return;
    setTracking(true);
    try {
      const res = await fetch(`/api/track-awb?orderId=${order.id}`);
      const data = await res.json();
      if (data.events) setTrackEvents(data.events);
    } catch (e) {
      setToast("Eroare la tracking");
    } finally {
      setTracking(false);
    }
  }

  // ── Detail row helper ──────────────────────────────────────────────────────
  function DetailRow({ label, value }) {
    return (
      <InlineStack align="space-between" blockAlign="center">
        <Text tone="subdued" variant="bodyMd">{label}</Text>
        <Text variant="bodyMd">{value || "—"}</Text>
      </InlineStack>
    );
  }

  return (
    <Frame>
      <Page
        title={order.shopifyOrderName}
        subtitle={`${order.customerName} · ${new Date(order.createdAt).toLocaleDateString("ro-RO")}`}
        backAction={{ content: "Comenzi", onAction: () => navigate("/app/orders") }}
        primaryAction={
          !order.awbNumber
            ? { content: "Generează AWB", onAction: () => setModalOpen(true), tone: "success" }
            : undefined
        }
        secondaryActions={[
          ...(order.awbNumber ? [
            {
              content: tracking ? "Se verifică..." : "Actualizează tracking",
              onAction: handleTrackAwb,
              loading: tracking,
            },
            {
              content: "Imprimă AWB",
              onAction: () => window.open(`/api/print-awb?orderId=${order.id}`, "_blank"),
            },
          ] : []),
          {
            content: "Vezi în Shopify",
            onAction: () => window.open(`https://${order.shop}/admin/orders/${order.shopifyOrderId}`, "_blank"),
          },
        ]}
      >
        <Layout>

          {/* ── Left column ────────────────────────────────────────────── */}
          <Layout.Section>
            <BlockStack gap="400">

              {/* Status + AWB banner */}
              {order.awbNumber ? (
                <Banner
                  title={`AWB: ${order.awbNumber}`}
                  tone={order.awbStatus === "delivered" ? "success" : "info"}
                >
                  <Text>Curier: {order.courierType === "fan" ? "FAN Courier" : "Sameday"}</Text>
                </Banner>
              ) : (
                <Banner title="AWB negenerat" tone="warning">
                  <Text>Apasă "Generează AWB" pentru a crea eticheta de livrare.</Text>
                </Banner>
              )}

              {/* Order details */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Detalii comandă</Text>
                  <Divider />
                  <DetailRow label="Nr. comandă Shopify" value={order.shopifyOrderName} />
                  <DetailRow label="Status AWB" value={
                    <Badge tone={statusCfg.tone}>{statusCfg.icon} {statusCfg.label}</Badge>
                  } />
                  <DetailRow label="Curier" value={order.courierType === "fan" ? "FAN Courier" : "Sameday"} />
                  <DetailRow label="Metodă livrare" value={
                    order.shippingMethod === "pickup_point"
                      ? `📦 Punct fix — ${order.pickupPointName || ""}`
                      : "🚚 Livrare la adresă"
                  } />
                  <DetailRow label="Ramburs (COD)" value={
                    order.codAmount > 0 ? `${order.codAmount.toFixed(2)} RON` : "Plătit online"
                  } />
                  <DetailRow label="Greutate" value={`${order.weight || 1} kg`} />
                  <DetailRow label="Colete" value={order.packageCount || 1} />
                </BlockStack>
              </Card>

              {/* Client info */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Client & Adresă livrare</Text>
                  <Divider />
                  <DetailRow label="Nume" value={order.customerName} />
                  <DetailRow label="Telefon" value={order.customerPhone} />
                  <DetailRow label="Email" value={order.customerEmail} />
                  <DetailRow label="Adresă" value={order.shippingAddress1} />
                  <DetailRow label="Localitate" value={`${order.shippingCity}, ${order.shippingCounty}`} />
                  <DetailRow label="Cod poștal" value={order.shippingZip} />
                </BlockStack>
              </Card>

              {/* Pickup point */}
              {order.shippingMethod === "pickup_point" && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" fontWeight="semibold">📦 Punct de ridicare</Text>
                    <Divider />
                    <DetailRow label="Nume" value={order.pickupPointName} />
                    <DetailRow label="Adresă" value={order.pickupPointAddress} />
                    <DetailRow label="ID extern" value={order.pickupPointId} />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>

          {/* ── Right column — Tracking ──────────────────────────────── */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" fontWeight="semibold">Tracking</Text>
                  {tracking && <Spinner size="small" />}
                </InlineStack>
                <Divider />

                {trackEvents.length === 0 ? (
                  <Box paddingBlock="400">
                    <Text tone="subdued" alignment="center">
                      {order.awbNumber
                        ? "Apasă 'Actualizează tracking' pentru ultimul status."
                        : "Generează AWB pentru a vedea tracking-ul."}
                    </Text>
                  </Box>
                ) : (
                  <BlockStack gap="300">
                    {trackEvents.map((ev, i) => {
                      const isLatest = i === 0;
                      return (
                        <div key={i} style={{ display:"flex", gap:12 }}>
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                            <div style={{
                              width: 12, height: 12, borderRadius:"50%",
                              background: isLatest ? "#108043" : "#ddd",
                              border: isLatest ? "2px solid #108043" : "2px solid #bbb",
                              flexShrink: 0, marginTop: 3,
                            }} />
                            {i < trackEvents.length - 1 && (
                              <div style={{ width:2, flex:1, background:"#eee", margin:"4px 0" }} />
                            )}
                          </div>
                          <div style={{ paddingBottom:12 }}>
                            <Text variant="bodyMd" fontWeight={isLatest ? "semibold" : "regular"}>
                              {ev.eventDesc || ev.description}
                            </Text>
                            {ev.location && (
                              <Text variant="bodySm" tone="subdued">📍 {ev.location}</Text>
                            )}
                            <Text variant="bodySm" tone="subdued">
                              {new Date(ev.eventDate).toLocaleString("ro-RO")}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

        </Layout>
      </Page>

      {/* ── Generate AWB Modal ─────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Generează AWB"
        primaryAction={{
          content: generating ? "Se generează..." : "Generează AWB",
          onAction: handleGenerateAwb,
          loading: generating,
          tone: "success",
        }}
        secondaryActions={[{ content: "Anulează", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {error && <Banner tone="critical" title="Eroare">{error}</Banner>}

            <Select
              label="Curier"
              value={courier}
              onChange={setCourier}
              options={[
                ...(settings?.fanEnabled     ? [{ label: "FAN Courier", value: "fan"     }] : []),
                ...(settings?.samedayEnabled ? [{ label: "Sameday",     value: "sameday" }] : []),
              ]}
            />

            <TextField
              label="Greutate (kg)"
              type="number"
              value={weight}
              onChange={setWeight}
              min="0.1"
              step="0.1"
              suffix="kg"
            />

            <Card background="bg-surface-secondary">
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">
                  Destinatar: <strong>{order.customerName}</strong> — {order.customerPhone}
                </Text>
                {order.shippingMethod === "pickup_point" ? (
                  <Text variant="bodySm" tone="subdued">
                    📦 Punct fix: <strong>{order.pickupPointName}</strong>
                  </Text>
                ) : (
                  <Text variant="bodySm" tone="subdued">
                    🚚 Adresă: {order.shippingAddress1}, {order.shippingCity}
                  </Text>
                )}
                <Text variant="bodySm" tone="subdued">
                  Ramburs: <strong>{order.codAmount > 0 ? `${order.codAmount} RON` : "Nu"}</strong>
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </Frame>
  );
}
