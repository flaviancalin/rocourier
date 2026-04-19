// app/routes/app.orders.$id.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { getOrder } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, Divider, Box, Banner, Modal, Select, RadioButton,
  TextField, Spinner, Toast, Frame, Checkbox, FormLayout,
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

// ── Static service lists (fallback if live fetch fails) ───────────────────────
const COURIER_SERVICES = {
  fan: [
    { label: "Standard",                          value: "Standard" },
    { label: "RedCode",                           value: "RedCode" },
    { label: "Export",                            value: "Export" },
    { label: "Cont Colector (FANbox)",            value: "Cont Colector" },
    { label: "Produse Albe",                      value: "Produse Albe" },
    { label: "Transport Marfă",                   value: "Transport Marfa" },
    { label: "Transport Marfă Produse Albe",      value: "Transport Marfa Produse Albe" },
  ],
  sameday: [
    { label: "Standard",                          value: "T" },
    { label: "Locker (NextDay)",                  value: "LN" },
    { label: "Express",                           value: "E" },
  ],
  cargus: [
    { label: "Standard",                          value: "10" },
    { label: "Economic Standard (< 31 kg)",       value: "34" },
    { label: "Standard Plus (31–50 kg)",          value: "35" },
    { label: "Palet (> 50 kg)",                   value: "36" },
    { label: "Pudo point / Easy Collect",         value: "38" },
    { label: "Standard Multipiece",              value: "39" },
  ],
  gls: [
    { label: "Business Parcel",                   value: "standard" },
  ],
  packeta: [
    { label: "Standard",                          value: "standard" },
  ],
};

const COURIER_LABELS = {
  fan: "FAN Courier", sameday: "Sameday",
  cargus: "Cargus", gls: "GLS", packeta: "Packeta",
};

const STATUS_MAP = {
  pending:          { label: "În așteptare",    tone: "warning",   icon: "⏳" },
  generated:        { label: "AWB generat",     tone: "info",      icon: "🏷️" },
  picked_up:        { label: "Preluat curier",  tone: "info",      icon: "📤" },
  in_transit:       { label: "În tranzit",      tone: "attention", icon: "🚚" },
  out_for_delivery: { label: "La livrare",      tone: "success",   icon: "🏠" },
  delivered:        { label: "Livrat",          tone: "success",   icon: "✅" },
  returned:         { label: "Retur",           tone: "critical",  icon: "↩️" },
  failed:           { label: "Eșuat",           tone: "critical",  icon: "❌" },
};

const FAN_OBSERVATIONS = [
  "Livrare urgentă",
  "Livrare luni",
  "De contactat telefonic",
  "Atenție - FRAGIL",
  "Livrare personală cu BI/CI",
  "Cu ștampilă și semnătură",
  "Livrare după ora 16:00",
  "Livrare interval 09:00-17:00",
];

function needsPickupPoint(courier, service, glsParcelShop) {
  if (courier === "fan")     return service === "Cont Colector";
  if (courier === "sameday") return /^LN|locker|easybox/i.test(String(service));
  if (courier === "cargus")  return String(service) === "38";
  if (courier === "packeta") return true;
  if (courier === "gls")     return !!glsParcelShop;
  return false;
}

function defaultServiceFor(courier, isPickup, services) {
  const opts = services || COURIER_SERVICES[courier] || [];
  if (isPickup) {
    const locker = opts.find((o) =>
      /locker|fanbox|colector|ln|pudo|packeta/i.test(o.label + o.value)
    );
    if (locker) return locker.value;
  }
  return opts[0]?.value || "standard";
}

export default function OrderDetail() {
  const { order, settings } = useLoaderData();
  const navigate = useNavigate();

  // ── Page-level state ───────────────────────────────────────────────────────
  const [generating, setGenerating]   = useState(false);
  const [tracking, setTracking]       = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [trackEvents, setTrackEvents] = useState(order.events || []);
  const [wizardOpen, setWizardOpen]   = useState(false);
  const [wizardStep, setWizardStep]   = useState(1);
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [toast, setToast]             = useState(null);
  const [error, setError]             = useState(null);
  const [liveServices, setLiveServices] = useState({});
  const [loadingServices, setLoadingServices] = useState(false);

  const isPickupOrder = order.shippingMethod === "pickup_point";

  // ── Step 1: Courier + Service + Options ───────────────────────────────────
  const [courier, setCourier] = useState(order.courierType || "fan");
  const [service, setService] = useState(() =>
    defaultServiceFor(order.courierType || "fan", isPickupOrder, null)
  );
  const [fanObservations, setFanObservations] = useState([]);
  const [openPackage, setOpenPackage]           = useState(false);
  const [saturdayDelivery, setSaturdayDelivery] = useState(false);
  const [morningDelivery, setMorningDelivery]   = useState(false);
  const [glsParcelShop, setGlsParcelShop]       = useState(
    isPickupOrder && order.courierType === "gls"
  );
  const [cargusReimbursement, setCargusReimbursement] = useState("cash");
  const [swapService, setSwapService]           = useState(false);

  // ── Step 2: Recipient + Pickup point ──────────────────────────────────────
  const [recipientName,    setRecipientName]    = useState(order.customerName    || "");
  const [recipientPhone,   setRecipientPhone]   = useState(order.customerPhone   || "");
  const [recipientEmail,   setRecipientEmail]   = useState(order.customerEmail   || "");
  const [recipientAddress, setRecipientAddress] = useState(order.shippingAddress1 || "");
  const [recipientAddressDetails, setRecipientAddressDetails] = useState("");
  const [recipientCity,    setRecipientCity]    = useState(order.shippingCity    || "");
  const [recipientCounty,  setRecipientCounty]  = useState(order.shippingCounty  || "");
  const [recipientZip,     setRecipientZip]     = useState(order.shippingZip     || "");
  const [recipientCountry, setRecipientCountry] = useState(order.shippingCountry || "RO");
  const [companyName,      setCompanyName]      = useState("");
  const [selectedPickupPoint, setSelectedPickupPoint] = useState(
    isPickupOrder && order.pickupPointId
      ? { externalId: order.pickupPointId, name: order.pickupPointName || "", address: order.pickupPointAddress || "" }
      : null
  );
  const [pickupSearch, setPickupSearch]     = useState("");
  const [pickupPoints, setPickupPoints]     = useState([]);
  const [loadingPickupPoints, setLoadingPickupPoints] = useState(false);

  // ── Step 3: Content ───────────────────────────────────────────────────────
  const [weight,       setWeight]       = useState(String(order.weight || 1));
  const [packageCount, setPackageCount] = useState(String(order.packageCount || 1));
  const [height,       setHeight]       = useState("0");
  const [width,        setWidth]        = useState("0");
  const [length,       setLength]       = useState("0");
  const [codAmount,    setCodAmount]    = useState(String(order.codAmount || 0));
  const [declaredValue, setDeclaredValue] = useState("0");
  const [shipmentPayer, setShipmentPayer] = useState("recipient");
  const [insuredValue,  setInsuredValue]  = useState("0");

  // ── Step 4: Observations ──────────────────────────────────────────────────
  const [observations,     setObservations]     = useState("");
  const [notifyCustomer,   setNotifyCustomer]   = useState(false);
  const [markAsDispatched, setMarkAsDispatched] = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function loadPickupPointsForCourier(c) {
    setLoadingPickupPoints(true);
    setPickupPoints([]);
    setPickupSearch("");
    try {
      const res  = await fetch(`/api/pickup-points?shop=${encodeURIComponent(order.shop)}&courier=${c}`);
      const data = await res.json();
      setPickupPoints(data.points || []);
    } catch (_) {
      setPickupPoints([]);
    } finally {
      setLoadingPickupPoints(false);
    }
  }

  function handleCourierChange(newCourier) {
    setCourier(newCourier);
    const opts = liveServices[newCourier] || COURIER_SERVICES[newCourier] || [];
    const svc  = defaultServiceFor(newCourier, false, opts);
    setService(svc);
    setFanObservations([]);
    setOpenPackage(false); setSaturdayDelivery(false); setMorningDelivery(false);
    setGlsParcelShop(false); setSwapService(false);
    setSelectedPickupPoint(null); setPickupPoints([]);
    if (needsPickupPoint(newCourier, svc, false)) loadPickupPointsForCourier(newCourier);
  }

  function handleServiceChange(newService) {
    setService(newService);
    setSelectedPickupPoint(null); setPickupPoints([]);
    if (needsPickupPoint(courier, newService, glsParcelShop)) {
      loadPickupPointsForCourier(courier);
    }
  }

  function toggleFanObs(obs) {
    setFanObservations((prev) => {
      if (prev.includes(obs)) return prev.filter((o) => o !== obs);
      if (prev.length >= 3)   return prev; // max 3
      return [...prev, obs];
    });
  }

  // ── Open wizard ───────────────────────────────────────────────────────────
  async function openWizard() {
    setWizardStep(1);
    setError(null);
    setWizardOpen(true);
    setLoadingServices(true);
    try {
      const res  = await fetch("/api/courier-services");
      const data = await res.json();
      setLiveServices(data);
      const opts = data[courier] || COURIER_SERVICES[courier] || [];
      const svc  = defaultServiceFor(courier, isPickupOrder, opts);
      setService(svc);
      if (needsPickupPoint(courier, svc, glsParcelShop)) loadPickupPointsForCourier(courier);
    } catch (_) {
      if (needsPickupPoint(courier, service, glsParcelShop)) loadPickupPointsForCourier(courier);
    } finally {
      setLoadingServices(false);
    }
  }

  // ── Generate AWB ──────────────────────────────────────────────────────────
  async function handleGenerateAwb() {
    setGenerating(true);
    setError(null);

    const allObservations = [
      ...fanObservations,
      ...(observations ? [observations] : []),
    ].join(", ");

    try {
      const res = await fetch("/api/generate-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          courierOverride: courier,
          serviceOverride: service,
          // Recipient overrides
          recipientName:    recipientName    || undefined,
          recipientPhone:   recipientPhone   || undefined,
          recipientEmail:   recipientEmail   || undefined,
          recipientAddress: recipientAddress || undefined,
          recipientCity:    recipientCity    || undefined,
          recipientCounty:  recipientCounty  || undefined,
          recipientZip:     recipientZip     || undefined,
          recipientCountry: recipientCountry || undefined,
          // Content
          weightOverride:       parseFloat(weight)      || 1,
          packageCountOverride: parseInt(packageCount)  || 1,
          height:   parseFloat(height)  || 0,
          width:    parseFloat(width)   || 0,
          length:   parseFloat(length)  || 0,
          codAmountOverride: parseFloat(codAmount),
          declaredValue:     parseFloat(declaredValue) || 0,
          shipmentPayer,
          insuredValue: parseFloat(insuredValue) || 0,
          // Options
          openPackage:      openPackage      || undefined,
          saturdayDelivery: saturdayDelivery || undefined,
          morningDelivery:  morningDelivery  || undefined,
          swapService:      swapService      || undefined,
          glsParcelShop:    (courier === "gls" && glsParcelShop) || undefined,
          cargusReimbursement: courier === "cargus" ? cargusReimbursement : undefined,
          observationsOverride: allObservations || undefined,
          pickupPointIdOverride: selectedPickupPoint?.externalId || undefined,
          // Step 4
          notifyCustomer:   notifyCustomer   || undefined,
          markAsDispatched: markAsDispatched || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToast(`AWB generat: ${data.awbNumber}`);
        setWizardOpen(false);
        setTimeout(() => navigate(`/app/orders/${order.id}`, { replace: true }), 1200);
      } else {
        setError(data.error || "AWB generation failed");
        setWizardStep(4); // stay on last step to show error
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
      const res  = await fetch("/api/delete-awb", {
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

  async function handleTrackAwb() {
    if (!order.awbNumber) return;
    setTracking(true);
    try {
      const res  = await fetch(`/api/track-awb?orderId=${order.id}`);
      const data = await res.json();
      if (data.events) setTrackEvents(data.events);
    } catch (_) {
      setToast("Eroare la tracking");
    } finally {
      setTracking(false);
    }
  }

  // ── Wizard step rendering ─────────────────────────────────────────────────
  const serviceOptions = liveServices[courier] || COURIER_SERVICES[courier] || [{ label: "Standard", value: "standard" }];
  const showPickup     = needsPickupPoint(courier, service, glsParcelShop);

  function StepIndicator() {
    const steps = ["Curier", "Destinatar", "Conținut", "Observații"];
    return (
      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", marginBottom: 20, border: "1px solid #ddd" }}>
        {steps.map((label, i) => {
          const n = i + 1;
          const active = n === wizardStep;
          const done   = n < wizardStep;
          return (
            <div
              key={n}
              onClick={() => done && setWizardStep(n)}
              style={{
                flex: 1, padding: "10px 4px", textAlign: "center", fontSize: 13,
                fontWeight: active ? 600 : 400,
                background: active ? "#008060" : done ? "#00a374" : "#f5f5f5",
                color: (active || done) ? "#fff" : "#555",
                cursor: done ? "pointer" : "default",
                borderRight: i < 3 ? "1px solid rgba(255,255,255,0.25)" : "none",
                userSelect: "none",
              }}
            >
              {n}. {label}
            </div>
          );
        })}
      </div>
    );
  }

  function renderStep1() {
    return (
      <BlockStack gap="400">
        <InlineStack gap="400" align="start">
          <div style={{ flex: 1 }}>
            <Select
              label="Curier"
              value={courier}
              onChange={handleCourierChange}
              helpText="Poți suprascrie curierul selectat. Prețurile pot diferi."
              options={[
                ...(settings?.fanEnabled     ? [{ label: "FAN Courier", value: "fan"     }] : []),
                ...(settings?.samedayEnabled ? [{ label: "Sameday",     value: "sameday" }] : []),
                ...(settings?.cargusEnabled  ? [{ label: "Cargus",      value: "cargus"  }] : []),
                ...(settings?.glsEnabled     ? [{ label: "GLS",         value: "gls"     }] : []),
                ...(settings?.packetaEnabled ? [{ label: "Packeta",     value: "packeta" }] : []),
              ]}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Select
              label={loadingServices ? "Tip serviciu (se încarcă...)" : "Tip serviciu"}
              value={service}
              onChange={handleServiceChange}
              disabled={loadingServices}
              helpText="Selectează serviciul potrivit curierului."
              options={serviceOptions}
            />
          </div>
        </InlineStack>

        {/* ── FAN options ── */}
        {courier === "fan" && (
          <InlineStack gap="500" align="start" blockAlign="start">
            <div style={{ flex: 1 }}>
              <Text variant="bodyMd" fontWeight="semibold">Observații (max 3)</Text>
              <div style={{ marginTop: 8 }}>
                {FAN_OBSERVATIONS.map((obs) => (
                  <div key={obs} style={{ marginBottom: 6 }}>
                    <Checkbox
                      label={obs}
                      checked={fanObservations.includes(obs)}
                      onChange={() => toggleFanObs(obs)}
                      disabled={!fanObservations.includes(obs) && fanObservations.length >= 3}
                    />
                  </div>
                ))}
                {fanObservations.length >= 3 && (
                  <Text variant="bodySm" tone="subdued">Maxim 3 observații selectate.</Text>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <Text variant="bodyMd" fontWeight="semibold">Opțiuni</Text>
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Livrare sâmbătă" checked={saturdayDelivery} onChange={setSaturdayDelivery} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Deschidere la livrare" checked={openPackage} onChange={setOpenPackage}
                    helpText="Destinatarul verifică înainte de a accepta" />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Serviciu Swap" checked={swapService} onChange={setSwapService} />
                </div>
              </div>
            </div>
          </InlineStack>
        )}

        {/* ── Cargus options ── */}
        {courier === "cargus" && (
          <InlineStack gap="500" align="start" blockAlign="start">
            <div style={{ flex: 1 }}>
              <Text variant="bodyMd" fontWeight="semibold">Tip ramburs</Text>
              <div style={{ marginTop: 8 }}>
                <RadioButton
                  label="Ramburs cash"
                  checked={cargusReimbursement === "cash"}
                  id="cargus-cash"
                  name="cargusReimbursement"
                  onChange={() => setCargusReimbursement("cash")}
                />
                <RadioButton
                  label="Ramburs cont colector"
                  checked={cargusReimbursement === "account"}
                  id="cargus-account"
                  name="cargusReimbursement"
                  onChange={() => setCargusReimbursement("account")}
                />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <Text variant="bodyMd" fontWeight="semibold">Opțiuni</Text>
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Deschidere la livrare" checked={openPackage} onChange={setOpenPackage}
                    helpText="Destinatarul verifică înainte de a accepta" />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Livrare sâmbătă" checked={saturdayDelivery} onChange={setSaturdayDelivery} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Livrare dimineața (Morning)" checked={morningDelivery} onChange={setMorningDelivery} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Checkbox label="Serviciu Swap" checked={swapService} onChange={setSwapService} />
                </div>
              </div>
            </div>
          </InlineStack>
        )}

        {/* ── Sameday options ── */}
        {courier === "sameday" && (
          <InlineStack gap="500" align="start" blockAlign="start">
            <div style={{ flex: 1 }}>
              <Checkbox label="Deschidere la livrare" checked={openPackage} onChange={setOpenPackage}
                helpText="Destinatarul verifică înainte de a accepta" />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label="Valoare asigurată (RON)"
                type="number" value={insuredValue} onChange={setInsuredValue}
                min="0" step="1" suffix="RON"
              />
            </div>
          </InlineStack>
        )}

        {/* ── GLS options ── */}
        {courier === "gls" && (
          <InlineStack gap="400" blockAlign="start">
            <div style={{ flex: 1 }}>
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
            </div>
            <div style={{ flex: 1 }}>
              <Checkbox label="Livrare sâmbătă" checked={saturdayDelivery} onChange={setSaturdayDelivery} />
            </div>
          </InlineStack>
        )}
      </BlockStack>
    );
  }

  function renderStep2() {
    const q = pickupSearch.toLowerCase();
    const filtered = pickupPoints.filter((p) =>
      !q || [p.name, p.city, p.county, p.address].some((f) => (f || "").toLowerCase().includes(q))
    ).slice(0, 30);

    return (
      <BlockStack gap="400">
        {/* Collect point selector */}
        {showPickup && (
          <BlockStack gap="200">
            <Text variant="headingSm" fontWeight="semibold">
              {courier === "fan"     ? "FANbox *" :
               courier === "gls"     ? "GLS ParcelShop *" :
               courier === "cargus"  ? "PUDO / Ship & Go *" :
               courier === "sameday" ? "Easybox *" : "Punct de ridicare *"}
            </Text>
            {selectedPickupPoint ? (
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="050">
                  <Text variant="bodySm" fontWeight="semibold">{selectedPickupPoint.name}</Text>
                  <Text variant="bodySm" tone="subdued">{selectedPickupPoint.address}</Text>
                </BlockStack>
                <Button size="micro" onClick={() => { setSelectedPickupPoint(null); loadPickupPointsForCourier(courier); }}>
                  Schimbă
                </Button>
              </InlineStack>
            ) : (
              <BlockStack gap="200">
                <TextField
                  labelHidden label="Caută" placeholder="Caută după oraș, adresă, nume..."
                  value={pickupSearch} onChange={setPickupSearch} autoComplete="off"
                />
                {loadingPickupPoints
                  ? <InlineStack align="center"><Spinner size="small" /></InlineStack>
                  : (
                    <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                      {filtered.length === 0
                        ? <Box padding="400"><Text tone="subdued" alignment="center">
                            {pickupPoints.length === 0
                              ? "Nicio locație. Sincronizează din Setări."
                              : "Nicio potrivire."}
                          </Text></Box>
                        : filtered.map((p) => (
                          <div key={p.id}
                            role="button" tabIndex={0}
                            onClick={() => setSelectedPickupPoint(p)}
                            onKeyDown={(e) => e.key === "Enter" && setSelectedPickupPoint(p)}
                            style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <Text variant="bodySm" fontWeight="semibold">{p.name}</Text>
                            <br />
                            <Text variant="bodySm" tone="subdued">
                              {[p.city, p.county].filter(Boolean).join(", ")}{p.address ? ` — ${p.address}` : ""}
                            </Text>
                          </div>
                        ))
                      }
                    </div>
                  )
                }
              </BlockStack>
            )}
            <Divider />
          </BlockStack>
        )}

        <FormLayout>
          <FormLayout.Group>
            <TextField label="Nume" value={recipientName}    onChange={setRecipientName}    autoComplete="off" />
            <TextField label="Email" value={recipientEmail}  onChange={setRecipientEmail}   autoComplete="off" type="email" />
            <TextField label="Telefon" value={recipientPhone} onChange={setRecipientPhone}  autoComplete="off" />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField label="Adresă" value={recipientAddress}             onChange={setRecipientAddress}        autoComplete="off" />
            <TextField label="Detalii adresă (bloc, ap.)" value={recipientAddressDetails} onChange={setRecipientAddressDetails} autoComplete="off" />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField label="Localitate" value={recipientCity}   onChange={setRecipientCity}   autoComplete="off" />
            <TextField label="Județ"      value={recipientCounty} onChange={setRecipientCounty} autoComplete="off" />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField label="Cod poștal" value={recipientZip}     onChange={setRecipientZip}     autoComplete="off" />
            <TextField label="Țară"        value={recipientCountry} onChange={setRecipientCountry} autoComplete="off" />
          </FormLayout.Group>
          <TextField label="Companie (opțional)" value={companyName} onChange={setCompanyName} autoComplete="off" />
        </FormLayout>
      </BlockStack>
    );
  }

  function renderStep3() {
    return (
      <BlockStack gap="400">
        {/* Order summary */}
        <Card background="bg-surface-secondary">
          <BlockStack gap="150">
            <Text variant="bodySm" fontWeight="semibold">{order.shopifyOrderName}</Text>
            <Text variant="bodySm" tone="subdued">
              Total comandă: {order.orderTotal > 0 ? `${order.orderTotal.toFixed(2)} RON` : "—"}
            </Text>
          </BlockStack>
        </Card>

        <FormLayout>
          <FormLayout.Group>
            <TextField label="Ramburs (COD)" type="number" value={codAmount}
              onChange={setCodAmount} min="0" step="0.01" suffix="RON"
              helpText="Suma de recuperat la livrare" />
            <TextField label="Valoare declarată" type="number" value={declaredValue}
              onChange={setDeclaredValue} min="0" step="0.01" suffix="RON"
              helpText="Valoarea declarată a coletului" />
          </FormLayout.Group>
          <FormLayout.Group>
            <Select
              label="Plata transportului"
              value={shipmentPayer}
              onChange={setShipmentPayer}
              options={[
                { label: "Destinatar", value: "recipient" },
                { label: "Expeditor",  value: "sender"    },
              ]}
            />
            <TextField label="Nr. colete" type="number" value={packageCount}
              onChange={setPackageCount} min="1" step="1" />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField label="Greutate" type="number" value={weight}
              onChange={setWeight} min="0.1" step="0.1" suffix="kg" />
          </FormLayout.Group>
          <Text variant="bodyMd" fontWeight="semibold">Dimensiuni colet</Text>
          <FormLayout.Group>
            <TextField label="Înălțime" type="number" value={height} onChange={setHeight} min="0" step="1" suffix="cm" />
            <TextField label="Lățime"   type="number" value={width}  onChange={setWidth}  min="0" step="1" suffix="cm" />
            <TextField label="Lungime"  type="number" value={length} onChange={setLength} min="0" step="1" suffix="cm" />
          </FormLayout.Group>
        </FormLayout>
      </BlockStack>
    );
  }

  function renderStep4() {
    return (
      <BlockStack gap="400">
        {error && <Banner tone="critical" title="Eroare la generare AWB" onDismiss={() => setError(null)}>
          <Text>{error}</Text>
        </Banner>}
        <TextField
          label="Conținut colet / Observații"
          value={observations}
          onChange={setObservations}
          multiline={4}
          placeholder="Ex: Fragil, a nu se răsturna. Livrare urgentă."
          helpText={courier === "fan" && fanObservations.length > 0
            ? `Observații selectate: ${fanObservations.join(", ")}`
            : undefined}
        />
        <BlockStack gap="300">
          <Checkbox
            label="Trimite notificare Shopify clientului"
            checked={notifyCustomer}
            onChange={setNotifyCustomer}
            helpText="Shopify va trimite un email de confirmare livrare"
          />
          <Checkbox
            label="Marchează comanda ca expediată"
            checked={markAsDispatched}
            onChange={setMarkAsDispatched}
            helpText="Setează statusul fulfillment-ului la 'success' în Shopify"
          />
        </BlockStack>

        {/* Summary card */}
        <Card background="bg-surface-secondary">
          <BlockStack gap="200">
            <Text variant="bodySm" fontWeight="semibold">Rezumat expediere</Text>
            <Text variant="bodySm" tone="subdued">
              Curier: <strong>{COURIER_LABELS[courier] || courier}</strong>
              {" · "}Serviciu: <strong>{serviceOptions.find((o) => o.value === service)?.label || service}</strong>
            </Text>
            <Text variant="bodySm" tone="subdued">
              Destinatar: <strong>{recipientName}</strong> — {recipientPhone}
            </Text>
            {showPickup && selectedPickupPoint ? (
              <Text variant="bodySm" tone="subdued">
                📦 Punct fix: <strong>{selectedPickupPoint.name}</strong>
              </Text>
            ) : (
              <Text variant="bodySm" tone="subdued">
                🚚 {recipientAddress}, {recipientCity}
              </Text>
            )}
            <Text variant="bodySm" tone="subdued">
              Ramburs: <strong>{parseFloat(codAmount) > 0 ? `${parseFloat(codAmount).toFixed(2)} RON` : "Nu"}</strong>
              {" · "}Greutate: <strong>{weight} kg</strong>
              {" · "}Colete: <strong>{packageCount}</strong>
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    );
  }

  // ── Page detail helpers ───────────────────────────────────────────────────
  function DetailRow({ label, value }) {
    return (
      <InlineStack align="space-between" blockAlign="center">
        <Text tone="subdued" variant="bodyMd">{label}</Text>
        <Text variant="bodyMd">{value || "—"}</Text>
      </InlineStack>
    );
  }

  const statusCfg = STATUS_MAP[order.awbStatus] || { label: order.awbStatus, tone: "default", icon: "📦" };

  return (
    <Frame>
      <Page
        title={order.shopifyOrderName}
        subtitle={`${order.customerName} · ${new Date(order.createdAt).toLocaleDateString("ro-RO")}`}
        backAction={{ content: "Comenzi", onAction: () => navigate("/app/orders") }}
        primaryAction={
          !order.awbNumber
            ? { content: "Generează AWB", onAction: openWizard, tone: "success" }
            : undefined
        }
        secondaryActions={[
          ...(order.awbNumber ? [
            { content: tracking ? "Se verifică..." : "Actualizează tracking", onAction: handleTrackAwb, loading: tracking },
            { content: "Imprimă AWB", onAction: () => window.open(`/api/print-awb?orderId=${order.id}`, "_blank") },
            { content: "Șterge AWB", onAction: () => setDeleteOpen(true), tone: "critical" },
          ] : []),
          { content: "Vezi în Shopify", onAction: () => window.open(`https://${order.shop}/admin/orders/${order.shopifyOrderId}`, "_blank") },
        ]}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {error && !wizardOpen && (
                <Banner tone="critical" title="Eroare" onDismiss={() => setError(null)}>
                  <Text>{error}</Text>
                </Banner>
              )}

              {order.awbNumber ? (
                <Banner title={`AWB: ${order.awbNumber}`} tone={order.awbStatus === "delivered" ? "success" : "info"}>
                  <Text>Curier: {COURIER_LABELS[order.courierType] || order.courierType}</Text>
                </Banner>
              ) : (
                <Banner title="AWB negenerat" tone="warning">
                  <Text>Apasă "Generează AWB" pentru a crea eticheta de livrare.</Text>
                </Banner>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Detalii comandă</Text>
                  <Divider />
                  <DetailRow label="Nr. comandă Shopify" value={order.shopifyOrderName} />
                  <DetailRow label="Status AWB" value={<Badge tone={statusCfg.tone}>{statusCfg.icon} {statusCfg.label}</Badge>} />
                  <DetailRow label="Curier" value={COURIER_LABELS[order.courierType] || order.courierType} />
                  <DetailRow label="Metodă livrare" value={
                    order.shippingMethod === "pickup_point"
                      ? `📦 Punct fix — ${order.pickupPointName || ""}`
                      : "🚚 Livrare la adresă"
                  } />
                  <DetailRow label="Ramburs (COD)" value={order.codAmount > 0 ? `${order.codAmount.toFixed(2)} RON` : "Plătit online"} />
                  <DetailRow label="Greutate" value={`${order.weight || 1} kg`} />
                  <DetailRow label="Colete" value={order.packageCount || 1} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Client & Adresă livrare</Text>
                  <Divider />
                  <DetailRow label="Nume"      value={order.customerName} />
                  <DetailRow label="Telefon"   value={order.customerPhone} />
                  <DetailRow label="Email"     value={order.customerEmail} />
                  <DetailRow label="Adresă"    value={order.shippingAddress1} />
                  <DetailRow label="Localitate" value={`${order.shippingCity || ""}${order.shippingCounty ? ", " + order.shippingCounty : ""}`} />
                  <DetailRow label="Cod poștal" value={order.shippingZip} />
                </BlockStack>
              </Card>

              {order.shippingMethod === "pickup_point" && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" fontWeight="semibold">📦 Punct de ridicare</Text>
                    <Divider />
                    <DetailRow label="Nume"     value={order.pickupPointName} />
                    <DetailRow label="Adresă"   value={order.pickupPointAddress} />
                    <DetailRow label="ID extern" value={order.pickupPointId} />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>

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
                        <div key={i} style={{ display: "flex", gap: 12 }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <div style={{
                              width: 12, height: 12, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                              background: isLatest ? "#108043" : "#ddd",
                              border: isLatest ? "2px solid #108043" : "2px solid #bbb",
                            }} />
                            {i < trackEvents.length - 1 && (
                              <div style={{ width: 2, flex: 1, background: "#eee", margin: "4px 0" }} />
                            )}
                          </div>
                          <div style={{ paddingBottom: 12 }}>
                            <Text variant="bodyMd" fontWeight={isLatest ? "semibold" : "regular"}>
                              {ev.eventDesc || ev.description}
                            </Text>
                            {ev.location && <Text variant="bodySm" tone="subdued">📍 {ev.location}</Text>}
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

      {/* ── Generate AWB Wizard Modal ─────────────────────────────────────── */}
      <Modal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title={`Generează AWB — ${order.shopifyOrderName}`}
        size="large"
      >
        <Modal.Section>
          <StepIndicator />

          {wizardStep === 1 && renderStep1()}
          {wizardStep === 2 && renderStep2()}
          {wizardStep === 3 && renderStep3()}
          {wizardStep === 4 && renderStep4()}

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24, paddingTop: 16, borderTop: "1px solid #e0e0e0" }}>
            {wizardStep > 1 && (
              <Button onClick={() => setWizardStep((s) => s - 1)}>Anterior</Button>
            )}
            {wizardStep < 4 ? (
              <Button
                variant="primary"
                onClick={() => {
                  if (wizardStep === 2 && showPickup && !selectedPickupPoint) {
                    setError("Selectează un punct de ridicare înainte de a continua.");
                    return;
                  }
                  setError(null);
                  setWizardStep((s) => s + 1);
                }}
              >
                Următor
              </Button>
            ) : (
              <Button
                variant="primary"
                tone="success"
                loading={generating}
                onClick={handleGenerateAwb}
              >
                {generating ? "Se generează..." : "Generează AWB"}
              </Button>
            )}
          </div>
        </Modal.Section>
      </Modal>

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
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
            <Text>Ești sigur că vrei să ștergi AWB-ul <strong>{order.awbNumber}</strong>?</Text>
            <Text tone="subdued">Ireversibil — posibil doar înainte ca curierii să preia coletul.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </Frame>
  );
}
