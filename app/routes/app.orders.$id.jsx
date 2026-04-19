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
  TextField, Spinner, Toast, Frame, Checkbox,
} from "@shopify/polaris";

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const order = await getOrder(session.shop, params.id);
  if (!order) throw new Response("Not found", { status: 404 });

  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
    select: {
      fanEnabled: true, samedayEnabled: true,
      cargusEnabled: true, glsEnabled: true, packetaEnabled: true,
    },
  });

  return json({ order, settings });
}

const COURIER_LABELS = {
  fan:     "FAN Courier",
  sameday: "Sameday",
  cargus:  "Cargus",
  gls:     "GLS",
  packeta: "Packeta",
};

const COURIER_SERVICES = {
  fan: [
    { label: "Standard",                 value: "Standard" },
    { label: "Cont Colector (FANbox)",   value: "Cont Colector" },
    { label: "RedCode",                  value: "RedCode" },
    { label: "Produse Albe",             value: "Produse Albe" },
    { label: "Transport Marfă",          value: "Transport Marfa" },
  ],
  sameday: [
    { label: "Standard",                 value: "T" },
    { label: "Locker (NextDay)",         value: "LN" },
    { label: "Express",                  value: "E" },
  ],
  cargus: [
    { label: "Standard",                          value: "10" },
    { label: "Economic Standard (< 31 kg)",       value: "34" },
    { label: "Standard Plus (31–50 kg)",          value: "35" },
    { label: "Pudo point / Easy Collect",         value: "38" },
    { label: "Standard Multipiece",              value: "39" },
  ],
  gls: [
    { label: "Business Parcel (Standard)",        value: "standard" },
  ],
  packeta: [
    { label: "Standard",                 value: "standard" },
  ],
};

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
  const [deleting, setDeleting]       = useState(false);
  const [trackEvents, setTrackEvents] = useState(order.events || []);
  const [modalOpen, setModalOpen]     = useState(false);
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [weight, setWeight]           = useState(String(order.weight || 1));
  const [packageCount, setPackageCount] = useState(String(order.packageCount || 1));
  const [courier, setCourier]         = useState(order.courierType || "fan");
  const [toast, setToast]             = useState(null);
  const [error, setError]             = useState(null);

  // Derive default service from order's delivery method
  function defaultService(courierKey, isPickup) {
    if (courierKey === "fan")     return isPickup ? "Cont Colector" : "Standard";
    if (courierKey === "sameday") return isPickup ? "LN" : "T";
    if (courierKey === "cargus")  return isPickup ? "38" : "10";
    return (COURIER_SERVICES[courierKey]?.[0]?.value) || "standard";
  }

  const [service, setService]           = useState(() => defaultService(order.courierType || "fan", order.shippingMethod === "pickup_point"));
  const [observations, setObservations] = useState("");
  const [openPackage, setOpenPackage]   = useState(false);
  const [saturdayDelivery, setSaturdayDelivery] = useState(false);
  const [morningDelivery, setMorningDelivery]   = useState(false);
  const [insuredValue, setInsuredValue] = useState("0");
  const [glsParcelShop, setGlsParcelShop] = useState(
    order.shippingMethod === "pickup_point" && order.courierType === "gls"
  );
  const [selectedPickupPoint, setSelectedPickupPoint] = useState(
    order.shippingMethod === "pickup_point" && order.pickupPointId
      ? { externalId: order.pickupPointId, name: order.pickupPointName || "", address: order.pickupPointAddress || "", city: null }
      : null
  );
  const [pickupSearch, setPickupSearch]         = useState("");
  const [pickupPoints, setPickupPoints]         = useState([]);
  const [loadingPickupPoints, setLoadingPickupPoints] = useState(false);
  const [liveServices, setLiveServices]       = useState({});
  const [loadingServices, setLoadingServices] = useState(false);

  function needsPickupPoint(c, svc) {
    if (c === "fan")     return svc === "Cont Colector";
    if (c === "sameday") return /^LN|locker|easybox/i.test(String(svc));
    if (c === "cargus")  return ["38"].includes(String(svc));
    if (c === "packeta") return true;
    if (c === "gls")     return glsParcelShop;
    return false;
  }

  async function loadPickupPointsForCourier(c) {
    setLoadingPickupPoints(true);
    setPickupPoints([]);
    setPickupSearch("");
    try {
      const res = await fetch(`/api/pickup-points?shop=${encodeURIComponent(order.shop)}&courier=${c}`);
      const data = await res.json();
      setPickupPoints(data.points || []);
    } catch (_) {
      setPickupPoints([]);
    } finally {
      setLoadingPickupPoints(false);
    }
  }

  const statusCfg = STATUS_MAP[order.awbStatus] || { label: order.awbStatus, tone: "default", icon: "📦" };

  // ── Open modal + fetch live services ──────────────────────────────────────
  async function openGenerateModal() {
    setModalOpen(true);
    setLoadingServices(true);
    try {
      const res = await fetch("/api/courier-services");
      const data = await res.json();
      setLiveServices(data);
      const opts = data[courier] || COURIER_SERVICES[courier] || [];
      const isPickup = order.shippingMethod === "pickup_point";
      const defaultSvc = isPickup
        ? (opts.find((o) => /locker|fanbox|colector|ln/i.test(o.label)) || opts[0])
        : opts[0];
      const svc = defaultSvc?.value || service;
      setService(svc);
      // Pre-load pickup points if the initial courier+service combo requires them
      if (needsPickupPoint(courier, svc) || (courier === "gls" && glsParcelShop)) {
        loadPickupPointsForCourier(courier);
      }
    } catch (_) {
      if (needsPickupPoint(courier, service) || (courier === "gls" && glsParcelShop)) {
        loadPickupPointsForCourier(courier);
      }
    } finally {
      setLoadingServices(false);
    }
  }

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
          packageCountOverride: parseInt(packageCount) || 1,
          serviceOverride: service,
          observationsOverride: observations || undefined,
          openPackage: openPackage || undefined,
          saturdayDelivery: saturdayDelivery || undefined,
          morningDelivery: morningDelivery || undefined,
          insuredValue: parseFloat(insuredValue) || undefined,
          pickupPointIdOverride: selectedPickupPoint?.externalId || undefined,
          glsParcelShop: (courier === "gls" && glsParcelShop) || undefined,
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

  // ── Delete AWB ─────────────────────────────────────────────────────────────
  async function handleDeleteAwb() {
    setDeleting(true);
    try {
      const res = await fetch("/api/delete-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (data.success) {
        setToast("AWB anulat cu succes");
        setDeleteOpen(false);
        setTimeout(() => navigate(`/app/orders/${order.id}`, { replace: true }), 1000);
      } else {
        setError(data.error || "Delete failed");
        setDeleteOpen(false);
      }
    } catch (e) {
      setError(e.message);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
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
            ? { content: "Generează AWB", onAction: openGenerateModal, tone: "success" }
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
            {
              content: "Șterge AWB",
              onAction: () => setDeleteOpen(true),
              tone: "critical",
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

              {/* Error banner */}
              {error && (
                <Banner tone="critical" title="Eroare" onDismiss={() => setError(null)}>
                  <Text>{error}</Text>
                </Banner>
              )}

              {/* Status + AWB banner */}
              {order.awbNumber ? (
                <Banner
                  title={`AWB: ${order.awbNumber}`}
                  tone={order.awbStatus === "delivered" ? "success" : "info"}
                >
                  <Text>Curier: {COURIER_LABELS[order.courierType] || order.courierType}</Text>
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
                  <DetailRow label="Curier" value={COURIER_LABELS[order.courierType] || order.courierType} />
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
              onChange={(v) => {
                setCourier(v);
                const opts = liveServices[v] || COURIER_SERVICES[v] || [];
                const svc = opts[0]?.value || "standard";
                setService(svc);
                setOpenPackage(false);
                setSaturdayDelivery(false);
                setMorningDelivery(false);
                setGlsParcelShop(false);
                setSelectedPickupPoint(null);
                setPickupPoints([]);
                if (needsPickupPoint(v, svc) || v === "packeta") {
                  loadPickupPointsForCourier(v);
                }
              }}
              options={[
                ...(settings?.fanEnabled     ? [{ label: "FAN Courier", value: "fan"     }] : []),
                ...(settings?.samedayEnabled ? [{ label: "Sameday",     value: "sameday" }] : []),
                ...(settings?.cargusEnabled  ? [{ label: "Cargus",      value: "cargus"  }] : []),
                ...(settings?.glsEnabled     ? [{ label: "GLS",         value: "gls"     }] : []),
                ...(settings?.packetaEnabled ? [{ label: "Packeta",     value: "packeta" }] : []),
              ]}
            />

            <Select
              label={loadingServices ? "Tip serviciu (se încarcă...)" : "Tip serviciu"}
              value={service}
              onChange={(svc) => {
                setService(svc);
                setSelectedPickupPoint(null);
                setPickupPoints([]);
                if (needsPickupPoint(courier, svc)) {
                  loadPickupPointsForCourier(courier);
                }
              }}
              disabled={loadingServices}
              options={liveServices[courier] || COURIER_SERVICES[courier] || [{ label: "Standard", value: "standard" }]}
            />

            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Greutate (kg)"
                  type="number"
                  value={weight}
                  onChange={setWeight}
                  min="0.1"
                  step="0.1"
                  suffix="kg"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Nr. colete"
                  type="number"
                  value={packageCount}
                  onChange={setPackageCount}
                  min="1"
                  step="1"
                />
              </div>
            </InlineStack>

            {/* Per-courier special options */}
            {(courier === "fan" || courier === "sameday" || courier === "cargus") && (
              <Checkbox
                label="Deschidere la livrare"
                checked={openPackage}
                onChange={setOpenPackage}
                helpText="Destinatarul poate verifica coletul înainte de a-l accepta"
              />
            )}
            {courier === "gls" && (
              <Checkbox
                label="Livrare la ParcelShop / Locker"
                checked={glsParcelShop}
                onChange={(checked) => {
                  setGlsParcelShop(checked);
                  setSelectedPickupPoint(null);
                  setPickupPoints([]);
                  if (checked) loadPickupPointsForCourier("gls");
                }}
              />
            )}
            {(courier === "cargus" || courier === "gls") && (
              <Checkbox
                label="Livrare sâmbătă"
                checked={saturdayDelivery}
                onChange={setSaturdayDelivery}
              />
            )}
            {courier === "cargus" && (
              <Checkbox
                label="Livrare dimineața (Morning Delivery)"
                checked={morningDelivery}
                onChange={setMorningDelivery}
              />
            )}
            {courier === "sameday" && (
              <TextField
                label="Valoare asigurată (RON)"
                type="number"
                value={insuredValue}
                onChange={setInsuredValue}
                min="0"
                step="1"
                suffix="RON"
              />
            )}

            {/* Pickup point selector — shows when service requires a locker/parcelshop */}
            {(needsPickupPoint(courier, service) || (courier === "gls" && glsParcelShop)) && (
              <BlockStack gap="200">
                <Text variant="headingSm">
                  {courier === "fan"     ? "FANbox *" :
                   courier === "gls"     ? "GLS ParcelShop *" :
                   courier === "cargus"  ? "PUDO / Ship & Go *" :
                   courier === "sameday" ? "Easybox *" :
                                          "Punct de ridicare *"}
                </Text>
                {selectedPickupPoint ? (
                  <InlineStack align="space-between" blockAlign="start" gap="200">
                    <BlockStack gap="050">
                      <Text variant="bodySm" fontWeight="semibold">{selectedPickupPoint.name}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {[selectedPickupPoint.city, selectedPickupPoint.county].filter(Boolean).join(", ")}
                        {selectedPickupPoint.address ? ` — ${selectedPickupPoint.address}` : ""}
                      </Text>
                    </BlockStack>
                    <Button size="micro" onClick={() => { setSelectedPickupPoint(null); loadPickupPointsForCourier(courier); }}>
                      Schimbă
                    </Button>
                  </InlineStack>
                ) : (
                  <BlockStack gap="200">
                    <TextField
                      labelHidden
                      label="Caută punct"
                      placeholder="Caută după oraș, adresă, nume..."
                      value={pickupSearch}
                      onChange={setPickupSearch}
                      autoComplete="off"
                    />
                    {loadingPickupPoints ? (
                      <InlineStack align="center"><Spinner size="small" /></InlineStack>
                    ) : (
                      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: 8 }}>
                        {(() => {
                          const q = pickupSearch.toLowerCase();
                          const filtered = pickupPoints.filter((p) =>
                            !q ||
                            p.name?.toLowerCase().includes(q) ||
                            (p.city || "").toLowerCase().includes(q) ||
                            (p.county || "").toLowerCase().includes(q) ||
                            (p.address || "").toLowerCase().includes(q)
                          ).slice(0, 30);
                          if (filtered.length === 0) {
                            return (
                              <Box padding="400">
                                <Text tone="subdued" alignment="center">
                                  {pickupPoints.length === 0
                                    ? "Nicio locație disponibilă. Sincronizează pickup points din Settings."
                                    : "Nicio potrivire găsită."}
                                </Text>
                              </Box>
                            );
                          }
                          return filtered.map((p) => (
                            <div
                              key={p.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedPickupPoint(p)}
                              onKeyDown={(e) => e.key === "Enter" && setSelectedPickupPoint(p)}
                              style={{
                                padding: "8px 12px",
                                cursor: "pointer",
                                borderBottom: "1px solid #f5f5f5",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f9fafb"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                            >
                              <Text variant="bodySm" fontWeight="semibold">{p.name}</Text>
                              <br />
                              <Text variant="bodySm" tone="subdued">
                                {[p.city, p.county].filter(Boolean).join(", ")}
                                {p.address ? ` — ${p.address}` : ""}
                              </Text>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            )}

            <TextField
              label="Observații (opțional)"
              value={observations}
              onChange={setObservations}
              multiline={2}
              placeholder="Ex: Fragil, a nu se răsturna"
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

      {/* ── Delete AWB Confirmation Modal ─────────────────────────────────── */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Șterge AWB"
        primaryAction={{
          content: deleting ? "Se anulează..." : "Confirmă ștergerea",
          onAction: handleDeleteAwb,
          loading: deleting,
          tone: "critical",
          destructive: true,
        }}
        secondaryActions={[{ content: "Anulează", onAction: () => setDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text>
              Ești sigur că vrei să ștergi AWB-ul <strong>{order.awbNumber}</strong>?
            </Text>
            <Text tone="subdued">
              Această acțiune este ireversibilă și este posibilă doar înainte ca curierii să preia coletul.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </Frame>
  );
}
