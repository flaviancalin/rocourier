// app/routes/app.orders.jsx
// Full orders page — filterable, searchable, with bulk AWB generation

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { getOrders } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, Tabs, Badge, Button, Text,
  BlockStack, InlineStack, Select, TextField,
  Pagination, Modal, Banner, Checkbox, EmptyState,
  Toast, Frame, RadioButton, FormLayout, Spinner, Box, Divider,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

// ─── Background sync (fire-and-forget, never blocks page load) ───────────────
async function syncShopifyOrders(shop, token) {
  const FIELDS = "id,name,created_at,note_attributes,shipping_address,customer,total_price,line_items";
  let nextUrl = `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&fields=${FIELDS}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;

    const { orders: shopifyOrders } = await res.json();
    for (const o of shopifyOrders || []) {
      const attrs = {};
      (o.note_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

      const method  = attrs["_rc_method"]        || attrs["_rocourier_method"]        || "home_delivery";
      const courier = attrs["_rc_courier"]       || attrs["_rocourier_courier"]       || "fan";
      const pid     = attrs["_rc_point_id"]      || attrs["_rocourier_point_id"]      || null;
      const pname   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
      const paddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

      const sa = o.shipping_address || {};
      const weightKg = (o.line_items || []).reduce(
        (sum, item) => sum + (item.grams || 0) * (item.quantity || 1), 0
      ) / 1000;

      const data = {
        shopifyOrderName:    o.name,
        customerName:        [sa.first_name, sa.last_name].filter(Boolean).join(" ") || o.customer?.first_name || "Unknown",
        customerPhone:       sa.phone || o.customer?.phone || "",
        customerEmail:       o.customer?.email || "",
        shippingAddress1:    sa.address1 || "",
        shippingCity:        sa.city || "",
        shippingCounty:      sa.province || "",
        shippingZip:         sa.zip || "",
        shippingCountry:     sa.country_code || "RO",
        shippingMethod:      method,
        courierType:         courier,
        pickupPointId:       pid,
        pickupPointName:     pname,
        pickupPointAddress:  paddr,
        codAmount:           parseFloat(o.total_price) || 0,
        orderTotal:          parseFloat(o.total_price) || 0,
        weight:              weightKg > 0 ? weightKg : undefined,
        shopifyCreatedAt:    new Date(o.created_at),
      };

      await prisma.order.upsert({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(o.id) } },
        update: {
          shopifyOrderName:   data.shopifyOrderName,
          customerName:       data.customerName,
          customerPhone:      data.customerPhone,
          customerEmail:      data.customerEmail,
          shippingAddress1:   data.shippingAddress1,
          shippingCity:       data.shippingCity,
          shippingCounty:     data.shippingCounty,
          shippingZip:        data.shippingZip,
          codAmount:          data.codAmount,
          orderTotal:         data.orderTotal,
          ...(weightKg > 0 ? { weight: weightKg } : {}),
        },
        create: { shop, shopifyOrderId: String(o.id), awbStatus: "pending", ...data },
      });

      await prisma.order.updateMany({
        where: { shop, shopifyOrderId: String(o.id), awbStatus: "pending" },
        data: {
          shippingMethod:     data.shippingMethod,
          courierType:        data.courierType,
          pickupPointId:      data.pickupPointId,
          pickupPointName:    data.pickupPointName,
          pickupPointAddress: data.pickupPointAddress,
        },
      });
    }

    // Follow Shopify pagination via Link header
    const link = res.headers.get("Link") || "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const shop = session.shop;

  if (!shop) {
    return json({ orders: [], total: 0, totalPages: 1, page: 1, filters: { status: "", courier: "", method: "", search: "" } });
  }

  // Fire-and-forget — page loads immediately from DB, sync runs in background
  syncShopifyOrders(shop, session.accessToken).catch(() => {});

  const page    = parseInt(url.searchParams.get("page")    || "1");
  const status  = url.searchParams.get("status")  || "";
  const courier = url.searchParams.get("courier") || "";
  const method  = url.searchParams.get("method")  || "";
  const search  = url.searchParams.get("search")  || "";

  const [result, settings] = await Promise.all([
    getOrders({
      shop,
      page,
      perPage: 25,
      status:  status  || null,
      courier: courier || null,
      method:  method  || null,
      search:  search  || null,
    }),
    prisma.shopSettings.findUnique({
      where: { shop },
      select: { fanEnabled: true, samedayEnabled: true, cargusEnabled: true, glsEnabled: true, packetaEnabled: true },
    }),
  ]);

  return json({ ...result, filters: { status, courier, method, search }, settings: settings || {} });
}

// ─── Per-courier service lists ────────────────────────────────────────────────
const FAN_OBSERVATIONS = [
  "Livrare urgentă", "Livrare luni", "De contactat telefonic",
  "Atenție - FRAGIL", "Livrare personală cu BI/CI",
  "Cu ștampilă și semnătură", "Livrare după ora 16:00", "Livrare interval 09:00-17:00",
];

const FULL_COURIER_SERVICES = {
  fan: [
    { label: "Standard",                       value: "Standard" },
    { label: "RedCode",                        value: "RedCode" },
    { label: "Export",                         value: "Export" },
    { label: "Cont Colector (FANbox)",         value: "Cont Colector" },
    { label: "Produse Albe",                   value: "Produse Albe" },
    { label: "Transport Marfă",                value: "Transport Marfa" },
    { label: "Transport Marfă Produse Albe",   value: "Transport Marfa Produse Albe" },
  ],
  sameday: [
    { label: "Standard",          value: "T" },
    { label: "Locker (NextDay)",  value: "LN" },
    { label: "Express",           value: "E" },
  ],
  cargus: [
    { label: "Standard",                        value: "10" },
    { label: "Economic Standard (< 31 kg)",     value: "34" },
    { label: "Standard Plus (31–50 kg)",        value: "35" },
    { label: "Palet (> 50 kg)",                 value: "36" },
    { label: "Pudo point / Easy Collect",       value: "38" },
    { label: "Standard Multipiece",            value: "39" },
  ],
  gls:     [{ label: "Business Parcel", value: "standard" }],
  packeta: [{ label: "Standard",        value: "standard" }],
};

function needsPickupPoint(courier, service, glsParcelShop) {
  if (courier === "fan")     return service === "Cont Colector";
  if (courier === "sameday") return /^LN|locker|easybox/i.test(String(service));
  if (courier === "cargus")  return String(service) === "38";
  if (courier === "packeta") return true;
  if (courier === "gls")     return !!glsParcelShop;
  return false;
}

const COURIER_SERVICES = {
  fan: [
    { label: "Standard",                value: "Standard" },
    { label: "Cont Colector (FANbox)",  value: "Cont Colector" },
    { label: "RedCode",                 value: "RedCode" },
    { label: "Produse Albe",            value: "Produse Albe" },
    { label: "Transport Marfă",         value: "Transport Marfa" },
  ],
  sameday: [
    { label: "Standard",                value: "T" },
    { label: "Locker (NextDay)",        value: "LN" },
    { label: "Express",                 value: "E" },
  ],
  cargus: [
    { label: "Standard",                value: "standard" },
    { label: "Priority",                value: "priority" },
  ],
  gls: [
    { label: "Standard",                value: "standard" },
    { label: "Express",                 value: "express" },
  ],
  packeta: [
    { label: "Standard",                value: "standard" },
  ],
};

function defaultServiceForCourier(courierKey, hasPickup) {
  if (courierKey === "fan")     return hasPickup ? "Cont Colector" : "Standard";
  if (courierKey === "sameday") return hasPickup ? "LN" : "T";
  return COURIER_SERVICES[courierKey]?.[0]?.value || "standard";
}

// ─── Static courier map (brand names, no translation needed) ─────────────────
const COURIER_MAP = {
  fan:     { label: "FAN Courier", color: "#e65100", logo: "/logo-fan.svg"     },
  sameday: { label: "Sameday",     color: "#1565c0", logo: "/logo-sameday.svg" },
  cargus:  { label: "Cargus",      color: "#c62828", logo: "/logo-cargus.png"  },
  gls:     { label: "GLS",         color: "#f9a825", logo: "/logo-gls.svg"     },
  packeta: { label: "Packeta",     color: "#ba000d", logo: "/logo-packeta.svg" },
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { orders, total, totalPages, page, filters, settings } = useLoaderData();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [syncing, setSyncing]               = useState(false);
  const [syncError, setSyncError]           = useState(null);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [generatingAwb, setGeneratingAwb]   = useState(false);
  const [awbResults, setAwbResults]         = useState([]);
  const [showResults, setShowResults]       = useState(false);
  const [toastMsg, setToastMsg]             = useState(null);
  const [bulkPrinting, setBulkPrinting]     = useState(false);
  const [bulkFulfilling, setBulkFulfilling] = useState(false);
  const [fulfillResults, setFulfillResults] = useState([]);
  const [showFulfillResults, setShowFulfillResults] = useState(false);

  // ── Bulk AWB Wizard state ───────────────────────────────────────────────────
  const [showWizard, setShowWizard]           = useState(false);
  const [wizardCourier, setWizardCourier]     = useState("fan");
  const [wizardService, setWizardService]     = useState("Standard");
  const [wizardWeight, setWizardWeight]       = useState("");
  const [wizardObs, setWizardObs]             = useState("");
  const [liveServices, setLiveServices]       = useState({});
  const [loadingServices, setLoadingServices] = useState(false);

  // ── Single-order 4-step wizard state ───────────────────────────────────────
  const [activeOrder, setActiveOrder]         = useState(null);
  const [singleWizardOpen, setSingleWizardOpen] = useState(false);
  const [singleWizardStep, setSingleWizardStep] = useState(1);
  const [singleGenerating, setSingleGenerating] = useState(false);
  const [singleError, setSingleError]         = useState(null);
  // Step 1
  const [swCourier, setSwCourier]             = useState("fan");
  const [swService, setSwService]             = useState("Standard");
  const [swFanObs, setSwFanObs]               = useState([]);
  const [swOpenPackage, setSwOpenPackage]     = useState(false);
  const [swSaturday, setSwSaturday]           = useState(false);
  const [swMorning, setSwMorning]             = useState(false);
  const [swGlsShop, setSwGlsShop]             = useState(false);
  const [swCargusReimb, setSwCargusReimb]     = useState("cash");
  const [swSwap, setSwSwap]                   = useState(false);
  const [swInsured, setSwInsured]             = useState("0");
  // Step 2
  const [swName, setSwName]                   = useState("");
  const [swPhone, setSwPhone]                 = useState("");
  const [swEmail, setSwEmail]                 = useState("");
  const [swAddress, setSwAddress]             = useState("");
  const [swAddrDetails, setSwAddrDetails]     = useState("");
  const [swCity, setSwCity]                   = useState("");
  const [swCounty, setSwCounty]               = useState("");
  const [swZip, setSwZip]                     = useState("");
  const [swCountry, setSwCountry]             = useState("RO");
  const [swCompany, setSwCompany]             = useState("");
  const [swPickupPoint, setSwPickupPoint]     = useState(null);
  const [swPickupSearch, setSwPickupSearch]   = useState("");
  const [swPickupPoints, setSwPickupPoints]   = useState([]);
  const [swLoadingPP, setSwLoadingPP]         = useState(false);
  // Step 3
  const [swWeight, setSwWeight]               = useState("1");
  const [swPkgCount, setSwPkgCount]           = useState("1");
  const [swHeight, setSwHeight]               = useState("0");
  const [swWidth, setSwWidth]                 = useState("0");
  const [swLength, setSwLength]               = useState("0");
  const [swCod, setSwCod]                     = useState("0");
  const [swDeclared, setSwDeclared]           = useState("0");
  const [swPayer, setSwPayer]                 = useState("recipient");
  // Step 4
  const [swNotes, setSwNotes]                 = useState("");
  const [swNotify, setSwNotify]               = useState(false);
  const [swDispatched, setSwDispatched]       = useState(false);
  const [swEstPrice, setSwEstPrice]           = useState(null);
  const [swEstLoading, setSwEstLoading]       = useState(false);

  const [activeTab, setActiveTab]     = useState(0);
  const [expandedRows, setExpandedRows] = useState([]);

  const [searchVal, setSearchVal]   = useState(filters.search);
  const [statusVal, setStatusVal]   = useState(filters.status);
  const [courierVal, setCourierVal] = useState(filters.courier);
  const [methodVal, setMethodVal]   = useState(filters.method);

  function applyFilters() {
    const params = new URLSearchParams({
      page: "1",
      ...(searchVal  ? { search:  searchVal  } : {}),
      ...(statusVal  ? { status:  statusVal  } : {}),
      ...(courierVal ? { courier: courierVal } : {}),
      ...(methodVal  ? { method:  methodVal  } : {}),
    });
    navigate(`/app/orders?${params}`);
  }

  function clearFilters() {
    setSearchVal(""); setStatusVal(""); setCourierVal(""); setMethodVal("");
    navigate("/app/orders");
  }

  const toggleSelect = (id) =>
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const selectAll = () =>
    setSelectedOrders(selectedOrders.length === orders.length ? [] : orders.map((o) => o.id));

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sync-orders", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
      } else {
        setToastMsg(t("sync_success", { n: data.synced }));
        setTimeout(() => navigate(window.location.pathname + window.location.search), 800);
      }
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const selectedWithAwb = selectedOrders.filter(
    (id) => orders.find((o) => o.id === id)?.awbNumber
  );

  async function handleBulkPrint() {
    if (!selectedWithAwb.length) return;
    setBulkPrinting(true);
    try {
      const ids = selectedWithAwb.join(",");
      const res = await fetch(`/api/bulk-print-awb?orderIds=${ids}`);
      if (!res.ok) {
        const text = await res.text();
        setToastMsg(`${t("error")}: ${text.slice(0, 120)}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AWB_bulk_${new Date().toISOString().slice(0,10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToastMsg(`${selectedWithAwb.length} AWB-uri descărcate`);
    } catch (e) {
      setToastMsg(`${t("error")}: ${e.message}`);
    } finally {
      setBulkPrinting(false);
    }
  }

  async function handleBulkFulfill() {
    if (!selectedWithAwb.length) return;
    setBulkFulfilling(true);
    try {
      const res = await fetch("/api/bulk-fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedWithAwb }),
      });
      const data = await res.json();
      setFulfillResults(data.results || []);
      setShowFulfillResults(true);
      setToastMsg(`Finalizate: ${data.succeeded || 0} ✓, ${data.failed || 0} ✗`);
    } catch (e) {
      setToastMsg(`${t("error")}: ${e.message}`);
    } finally {
      setBulkFulfilling(false);
    }
  }

  function handlePackingSlip() {
    if (!selectedOrders.length) return;
    window.open(`/api/packing-slip?orderIds=${selectedOrders.join(",")}`, "_blank");
  }

  async function openAwbWizard() {
    if (selectedOrders.length === 0) return;
    const firstOrder = orders.find((o) => o.id === selectedOrders[0]);
    const firstCourier = firstOrder?.courierType || "fan";
    const hasPickup = firstOrder?.shippingMethod === "pickup_point";
    setWizardCourier(firstCourier);
    setWizardWeight("");
    setWizardObs("");
    setShowWizard(true);

    // Fetch live services from each courier's API
    setLoadingServices(true);
    try {
      const res = await fetch("/api/courier-services");
      const data = await res.json();
      setLiveServices(data);
      // Set default service for the pre-filled courier
      const options = data[firstCourier] || COURIER_SERVICES[firstCourier] || [];
      const defaultSvc = hasPickup
        ? (options.find((o) => /locker|fanbox|colector|ln/i.test(o.label)) || options[0])
        : options[0];
      setWizardService(defaultSvc?.value || options[0]?.value || "Standard");
    } catch (_) {
      setWizardService(defaultServiceForCourier(firstCourier, hasPickup));
    } finally {
      setLoadingServices(false);
    }
  }

  async function confirmGenerateAwbs() {
    setShowWizard(false);
    setGeneratingAwb(true);
    setAwbResults([]);

    const results = [];
    for (const orderId of selectedOrders) {
      try {
        const res = await fetch("/api/generate-awb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            courierOverride: wizardCourier,
            serviceOverride: wizardService,
            ...(wizardWeight ? { weightOverride: parseFloat(wizardWeight) } : {}),
            ...(wizardObs    ? { observationsOverride: wizardObs }          : {}),
          }),
        });
        const data = await res.json();
        const order = orders.find((o) => o.id === orderId);
        results.push({
          orderId,
          orderName: order?.shopifyOrderName,
          success: data.success,
          awbNumber: data.awbNumber,
          error: data.error,
        });
      } catch (e) {
        results.push({ orderId, success: false, error: e.message });
      }
    }

    setAwbResults(results);
    setGeneratingAwb(false);
    setShowResults(true);
    setSelectedOrders([]);
    setTimeout(() => navigate(window.location.pathname + window.location.search), 1500);
  }

  // ── Single-order wizard helpers ────────────────────────────────────────────
  async function loadSwPickupPoints(c) {
    setSwLoadingPP(true); setSwPickupPoints([]); setSwPickupSearch("");
    try {
      const res  = await fetch(`/api/pickup-points?shop=${encodeURIComponent(activeOrder?.shop || "")}&courier=${c}`);
      const data = await res.json();
      setSwPickupPoints(data.points || []);
    } catch (_) { setSwPickupPoints([]); }
    finally { setSwLoadingPP(false); }
  }

  function openSingleWizard(o) {
    const isPickup = o.shippingMethod === "pickup_point";
    const c = o.courierType || "fan";
    const opts = liveServices[c] || FULL_COURIER_SERVICES[c] || [];
    let svc = opts[0]?.value || "Standard";
    if (isPickup) {
      const lockerOpt = opts.find((x) => /locker|fanbox|colector|ln|pudo/i.test(x.label + x.value));
      if (lockerOpt) svc = lockerOpt.value;
    }
    setActiveOrder(o);
    setSingleWizardStep(1); setSingleError(null);
    setSwCourier(c); setSwService(svc);
    setSwFanObs([]); setSwOpenPackage(false); setSwSaturday(false);
    setSwMorning(false); setSwGlsShop(isPickup && c === "gls");
    setSwCargusReimb("cash"); setSwSwap(false); setSwInsured("0");
    setSwName(o.customerName || ""); setSwPhone(o.customerPhone || "");
    setSwEmail(o.customerEmail || ""); setSwAddress(o.shippingAddress1 || "");
    setSwAddrDetails(""); setSwCity(o.shippingCity || "");
    setSwCounty(o.shippingCounty || ""); setSwZip(o.shippingZip || "");
    setSwCountry(o.shippingCountry || "RO"); setSwCompany("");
    setSwPickupPoint(isPickup && o.pickupPointId
      ? { externalId: o.pickupPointId, name: o.pickupPointName || "", address: o.pickupPointAddress || "" }
      : null
    );
    setSwPickupPoints([]); setSwPickupSearch("");
    setSwWeight(String(o.weight || 1)); setSwPkgCount(String(o.packageCount || 1));
    setSwHeight("0"); setSwWidth("0"); setSwLength("0");
    setSwCod(String(o.codAmount || 0)); setSwDeclared("0"); setSwPayer("recipient");
    setSwNotes(""); setSwNotify(false); setSwDispatched(false);
    setSwEstPrice(null); setSwEstLoading(false);
    setSingleWizardOpen(true);
    if (needsPickupPoint(c, svc, isPickup && c === "gls")) {
      // defer so activeOrder is set
      setTimeout(() => loadSwPickupPoints(c), 0);
    }
  }

  async function submitSingleWizard() {
    if (!activeOrder) return;
    setSingleGenerating(true); setSingleError(null);
    const allObs = [...swFanObs, ...(swNotes ? [swNotes] : [])].join(", ");
    try {
      const res = await fetch("/api/generate-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: activeOrder.id,
          courierOverride: swCourier, serviceOverride: swService,
          recipientName: swName, recipientPhone: swPhone, recipientEmail: swEmail,
          recipientAddress: swAddress, recipientCity: swCity,
          recipientCounty: swCounty, recipientZip: swZip, recipientCountry: swCountry,
          weightOverride: parseFloat(swWeight) || 1,
          packageCountOverride: parseInt(swPkgCount) || 1,
          height: parseFloat(swHeight) || 0, width: parseFloat(swWidth) || 0, length: parseFloat(swLength) || 0,
          codAmountOverride: parseFloat(swCod),
          declaredValue: parseFloat(swDeclared) || 0,
          shipmentPayer: swPayer,
          insuredValue: parseFloat(swInsured) || 0,
          openPackage: swOpenPackage || undefined,
          saturdayDelivery: swSaturday || undefined,
          morningDelivery: swMorning || undefined,
          swapService: swSwap || undefined,
          glsParcelShop: (swCourier === "gls" && swGlsShop) || undefined,
          cargusReimbursement: swCourier === "cargus" ? swCargusReimb : undefined,
          observationsOverride: allObs || undefined,
          pickupPointIdOverride: swPickupPoint?.externalId || undefined,
          notifyCustomer: swNotify || undefined,
          markAsDispatched: swDispatched || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMsg(`AWB generat: ${data.awbNumber}`);
        setSingleWizardOpen(false);
        setTimeout(() => navigate(window.location.pathname + window.location.search), 800);
      } else {
        setSingleError(data.error || "Eroare la generare AWB");
        setSingleWizardStep(4);
      }
    } catch (e) { setSingleError(e.message); }
    finally { setSingleGenerating(false); }
  }

  async function estimateShipping() {
    setSwEstPrice(null); setSwEstLoading(true);
    try {
      const res = await fetch("/api/estimate-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: activeOrder?.id,
          courier: swCourier, service: swService,
          weight: parseFloat(swWeight) || 1,
          packageCount: parseInt(swPkgCount) || 1,
          codAmount: parseFloat(swCod) || 0,
          recipientCity: swCity, recipientCounty: swCounty,
        }),
      });
      const data = await res.json();
      if (data.price) setSwEstPrice(data);
    } catch (_) { /* non-fatal */ }
    finally { setSwEstLoading(false); }
  }

  // ── Tab filtering ──────────────────────────────────────────────────────────
  const TABS = [
    { content: "Comenzi noi",  id: "new"        },
    { content: "În progres",   id: "progress"   },
    { content: "Expediate",    id: "dispatched" },
    { content: "Toate",        id: "all"        },
  ];
  const TAB_FILTER = [
    (o) => o.awbStatus === "pending",
    (o) => ["generated", "picked_up", "in_transit", "out_for_delivery"].includes(o.awbStatus),
    (o) => ["delivered", "returned", "failed"].includes(o.awbStatus),
    () => true,
  ];
  const displayedOrders = orders.filter(TAB_FILTER[activeTab] || (() => true));

  function toggleExpand(id) {
    setExpandedRows((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <Frame>
      <Page
        title={t("orders_title")}
        subtitle={t("orders_subtitle", { n: total })}
        primaryAction={{
          content: syncing ? t("syncing") : t("sync_btn"),
          onAction: handleSync,
          loading: syncing,
        }}
      >
        <Layout>
          {/* Sync error */}
          {syncError && (
            <Layout.Section>
              <Banner tone="critical" title={t("sync_error_title")} onDismiss={() => setSyncError(null)}>
                <Text>{syncError}</Text>
              </Banner>
            </Layout.Section>
          )}

          {/* Filters */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
                  <div style={{ flex:"2 1 220px" }}>
                    <TextField
                      label={t("search")}
                      placeholder={t("search_placeholder")}
                      value={searchVal}
                      onChange={setSearchVal}
                      onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                      clearButton
                      onClearButtonClick={() => setSearchVal("")}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label="Status"
                      value={statusVal}
                      onChange={setStatusVal}
                      options={[
                        { label: t("all_statuses"),          value: "" },
                        { label: t("status_pending"),        value: "pending" },
                        { label: t("status_generated"),      value: "generated" },
                        { label: t("status_in_transit"),     value: "in_transit" },
                        { label: t("status_delivered"),      value: "delivered" },
                        { label: t("status_returned"),       value: "returned" },
                      ]}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label={t("col_courier")}
                      value={courierVal}
                      onChange={setCourierVal}
                      options={[
                        { label: t("all_couriers"), value: ""       },
                        { label: "FAN Courier",     value: "fan"     },
                        { label: "Sameday",         value: "sameday" },
                        { label: "Cargus",          value: "cargus"  },
                        { label: "GLS",             value: "gls"     },
                        { label: "Packeta",         value: "packeta" },
                      ]}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label={t("method_label")}
                      value={methodVal}
                      onChange={setMethodVal}
                      options={[
                        { label: t("all_methods"),    value: "" },
                        { label: t("home_delivery"),  value: "home_delivery" },
                        { label: t("pickup_point"),   value: "pickup_point" },
                      ]}
                    />
                  </div>
                  <div style={{ display:"flex", gap:8, paddingTop:24 }}>
                    <Button onClick={applyFilters} variant="primary">{t("filter")}</Button>
                    <Button onClick={clearFilters}>{t("reset")}</Button>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Orders table */}
          <Layout.Section>
            <Card padding="0">
              <Tabs tabs={TABS} selected={activeTab} onSelect={(i) => { setActiveTab(i); setExpandedRows([]); }} />

              {/* Bulk action bar */}
              {selectedOrders.length > 0 && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", padding:"10px 16px", background:"#f6f6f7", borderBottom:"1px solid #e1e3e5" }}>
                  <Button variant="primary" tone="success" loading={generatingAwb} onClick={openAwbWizard}>
                    {generatingAwb ? t("generating") : `${t("generate_awb")} (${selectedOrders.length})`}
                  </Button>
                  {selectedWithAwb.length > 0 && (
                    <>
                      <Button loading={bulkPrinting} onClick={handleBulkPrint}>
                        {bulkPrinting ? t("downloading") : t("print_awbs", { n: selectedWithAwb.length })}
                      </Button>
                      <Button loading={bulkFulfilling} onClick={handleBulkFulfill}>
                        {bulkFulfilling ? t("fulfilling") : t("fulfill_shopify", { n: selectedWithAwb.length })}
                      </Button>
                    </>
                  )}
                  <Button onClick={handlePackingSlip}>{t("packing_slip", { n: selectedOrders.length })}</Button>
                  <Button variant="plain" onClick={() => setSelectedOrders([])}>{t("cancel_selection")}</Button>
                  <span style={{ marginLeft:"auto", display:"flex", alignItems:"center" }}>
                    <Text tone="subdued">{selectedOrders.length} {t("selected")}</Text>
                  </span>
                </div>
              )}

              {orders.length === 0 ? (
                <div style={{ padding:32 }}>
                  <EmptyState
                    heading={t("no_orders_found")}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>{t("no_orders_hint")}</p>
                  </EmptyState>
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div style={{
                    display:"grid",
                    gridTemplateColumns:"36px 100px minmax(140px,1fr) 90px 95px 130px 105px 90px 148px",
                    gap:0,
                    padding:"8px 16px",
                    background:"#f6f6f7",
                    borderBottom:"1px solid #e1e3e5",
                    fontSize:12,
                    fontWeight:600,
                    color:"#6d7175",
                    alignItems:"center",
                  }}>
                    <div>
                      <Checkbox label="" labelHidden
                        checked={selectedOrders.length === orders.length && orders.length > 0}
                        onChange={selectAll} />
                    </div>
                    <div>{t("col_order")}</div>
                    <div>{t("col_customer")}</div>
                    <div>{t("col_courier")}</div>
                    <div>{t("col_delivery")}</div>
                    <div>{t("col_awb")}</div>
                    <div>{t("col_status")}</div>
                    <div>Plată</div>
                    <div></div>
                  </div>

                  {/* Order rows */}
                  {displayedOrders.length === 0 ? (
                    <div style={{ padding:"32px 16px", textAlign:"center" }}>
                      <Text tone="subdued">Nicio comandă în această categorie.</Text>
                    </div>
                  ) : displayedOrders.map((o) => {
                    const tone       = STATUS_TONES[o.awbStatus] || "default";
                    const courierCfg = COURIER_MAP[o.courierType] || { label: o.courierType || "—", color: "#888" };
                    const isExpanded = expandedRows.includes(o.id);
                    const isPickup   = o.shippingMethod === "pickup_point";
                    const hasCod     = o.codAmount > 0;
                    const date       = new Date(o.createdAt).toLocaleDateString("ro-RO", { day:"2-digit", month:"2-digit", year:"numeric" });

                    return (
                      <div key={o.id} style={{ borderBottom:"1px solid #e1e3e5" }}>
                        {/* Main row */}
                        <div
                          style={{
                            display:"grid",
                            gridTemplateColumns:"36px 100px minmax(140px,1fr) 90px 95px 130px 105px 90px 148px",
                            gap:0,
                            padding:"10px 16px",
                            alignItems:"center",
                            background: selectedOrders.includes(o.id) ? "#f0faf5" : "white",
                            cursor:"default",
                          }}
                          onMouseEnter={(e) => { if (!selectedOrders.includes(o.id)) e.currentTarget.style.background = "#fafafa"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = selectedOrders.includes(o.id) ? "#f0faf5" : "white"; }}
                        >
                          {/* Checkbox */}
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox label="" labelHidden
                              checked={selectedOrders.includes(o.id)}
                              onChange={() => toggleSelect(o.id)} />
                          </div>

                          {/* Order # + date */}
                          <div>
                            <button
                              onClick={() => toggleExpand(o.id)}
                              style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#008060", fontWeight:600, fontSize:13 }}
                            >
                              {o.shopifyOrderName}
                            </button>
                            <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{date}</div>
                          </div>

                          {/* Customer name + address */}
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontWeight:600, fontSize:13, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {o.customerName || "—"}
                            </div>
                            <div style={{ fontSize:11, color:"#6d7175", marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                              title={[o.shippingAddress1, o.shippingCity, o.shippingCounty].filter(Boolean).join(", ")}>
                              {[o.shippingAddress1, o.shippingCity, o.shippingCounty].filter(Boolean).join(", ") || "—"}
                            </div>
                          </div>

                          {/* Courier badge — logo */}
                          <div>
                            {courierCfg.logo
                              ? <span style={{
                                  display:"inline-flex", alignItems:"center", justifyContent:"center",
                                  padding:"3px 6px", borderRadius:8,
                                  background:`${courierCfg.color}15`,
                                  border:`1px solid ${courierCfg.color}33`,
                                  width:72, height:30, boxSizing:"border-box",
                                }}>
                                  <img src={courierCfg.logo} alt={courierCfg.label}
                                    style={{ width:60, height:22, objectFit:"contain", display:"block" }} />
                                </span>
                              : <span style={{
                                  display:"inline-block", padding:"2px 7px", borderRadius:10, fontSize:11,
                                  fontWeight:600, background:`${courierCfg.color}18`, color:courierCfg.color,
                                  border:`1px solid ${courierCfg.color}44`, whiteSpace:"nowrap",
                                }}>
                                  {courierCfg.label}
                                </span>
                            }
                          </div>

                          {/* Delivery method */}
                          <div style={{ fontSize:12, color:"#6d7175" }}>
                            {isPickup
                              ? <span title={o.pickupPointName || ""}>📦 Pct. ridic.</span>
                              : <span>🚚 Acasă</span>
                            }
                          </div>

                          {/* AWB */}
                          <div>
                            {o.awbNumber
                              ? <code style={{ fontSize:11, background:"#f4f6f8", padding:"2px 5px", borderRadius:3, color:"#333" }}>{o.awbNumber}</code>
                              : <Text tone="subdued" variant="bodySm">—</Text>
                            }
                          </div>

                          {/* Status badge */}
                          <div>
                            <Badge tone={tone}>{t(`status_${o.awbStatus}`) || o.awbStatus}</Badge>
                          </div>

                          {/* Payment / COD */}
                          <div>
                            {hasCod
                              ? <span style={{ fontSize:11, fontWeight:600, color:"#b54708", background:"#fef3c7", padding:"2px 6px", borderRadius:8 }}>
                                  Ramburs
                                </span>
                              : <span style={{ fontSize:11, fontWeight:600, color:"#065f46", background:"#d1fae5", padding:"2px 6px", borderRadius:8 }}>
                                  Plătit
                                </span>
                            }
                            {hasCod && <div style={{ fontSize:11, color:"#6d7175", marginTop:2 }}>{o.codAmount.toFixed(2)} RON</div>}
                          </div>

                          {/* Actions */}
                          <div style={{ display:"flex", gap:6, justifyContent:"flex-end", overflow:"visible" }}>
                            {!o.awbNumber
                              ? <button
                                  onClick={(e) => { e.stopPropagation(); openSingleWizard(o); }}
                                  style={{
                                    background:"#008060", color:"#fff", border:"none", borderRadius:6,
                                    padding:"5px 10px", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#006e52"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#008060"; }}
                                >
                                  + AWB
                                </button>
                              : <button
                                  onClick={(e) => { e.stopPropagation(); openSingleWizard(o); }}
                                  style={{
                                    background:"#f6f6f7", color:"#444", border:"1px solid #ccc", borderRadius:6,
                                    padding:"5px 10px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap",
                                  }}
                                >
                                  Regenerează
                                </button>
                            }
                            <button
                              onClick={() => toggleExpand(o.id)}
                              style={{ background:"none", border:"1px solid #ddd", borderRadius:6, padding:"5px 8px", cursor:"pointer", fontSize:12, color:"#6d7175" }}
                              title={isExpanded ? "Restrânge" : "Detalii"}
                            >
                              {isExpanded ? "▲" : "▼"}
                            </button>
                          </div>
                        </div>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <div style={{ background:"#f9fafb", borderTop:"1px solid #e8e8e8", padding:"12px 16px 12px 52px" }}>
                            <div style={{ display:"flex", gap:32, flexWrap:"wrap" }}>
                              <div>
                                <Text variant="bodySm" fontWeight="semibold" tone="subdued">Adresă completă</Text>
                                <div style={{ marginTop:4, fontSize:13 }}>
                                  {o.shippingAddress1 && <div>{o.shippingAddress1}</div>}
                                  <div>{[o.shippingZip, o.shippingCity, o.shippingCounty].filter(Boolean).join(", ")}</div>
                                  {o.customerPhone && <div style={{ color:"#6d7175" }}>📞 {o.customerPhone}</div>}
                                  {o.customerEmail && <div style={{ color:"#6d7175" }}>✉ {o.customerEmail}</div>}
                                </div>
                              </div>

                              {isPickup && o.pickupPointName && (
                                <div>
                                  <Text variant="bodySm" fontWeight="semibold" tone="subdued">Punct de ridicare</Text>
                                  <div style={{ marginTop:4, fontSize:13 }}>
                                    <div style={{ fontWeight:600 }}>{o.pickupPointName}</div>
                                    {o.pickupPointAddress && <div style={{ color:"#6d7175" }}>{o.pickupPointAddress}</div>}
                                  </div>
                                </div>
                              )}

                              {o.awbNumber && (
                                <div>
                                  <Text variant="bodySm" fontWeight="semibold" tone="subdued">AWB</Text>
                                  <div style={{ marginTop:4, fontSize:13 }}>
                                    <code style={{ background:"#e8e8e8", padding:"2px 6px", borderRadius:4 }}>{o.awbNumber}</code>
                                    <div style={{ marginTop:4 }}>
                                      <Button size="micro" url={`/app/orders/${o.id}`}>Detalii comandă</Button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div>
                                <Text variant="bodySm" fontWeight="semibold" tone="subdued">Colet</Text>
                                <div style={{ marginTop:4, fontSize:13, color:"#6d7175" }}>
                                  {o.weight ? `${o.weight} kg` : "—"}
                                  {o.packageCount > 1 ? ` · ${o.packageCount} colete` : ""}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ padding:"12px 16px", borderTop:"1px solid #e1e3e5" }}>
                    <InlineStack align="center">
                      <Pagination
                        hasPrevious={page > 1}
                        hasNext={page < totalPages}
                        onPrevious={() => navigate(`/app/orders?page=${page - 1}`)}
                        onNext={() => navigate(`/app/orders?page=${page + 1}`)}
                        label={t("page_label", { p: page, t: totalPages })}
                      />
                    </InlineStack>
                  </div>
                </>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {/* AWB Wizard Modal */}
      {showWizard && (
        <Modal
          open={showWizard}
          onClose={() => setShowWizard(false)}
          title={`Generează AWB — ${selectedOrders.length} ${selectedOrders.length === 1 ? "comandă" : "comenzi"}`}
          primaryAction={{
            content: "Generează",
            onAction: confirmGenerateAwbs,
            tone: "success",
          }}
          secondaryActions={[{ content: "Anulează", onAction: () => setShowWizard(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Select
                label="Curier"
                value={wizardCourier}
                onChange={(v) => {
                  setWizardCourier(v);
                  const opts = liveServices[v] || COURIER_SERVICES[v] || [];
                  setWizardService(opts[0]?.value || "standard");
                }}
                options={[
                  ...(settings?.fanEnabled     ? [{ label: "FAN Courier", value: "fan"     }] : []),
                  ...(settings?.samedayEnabled ? [{ label: "Sameday",     value: "sameday" }] : []),
                  ...(settings?.cargusEnabled  ? [{ label: "Cargus",      value: "cargus"  }] : []),
                  ...(settings?.glsEnabled     ? [{ label: "GLS",         value: "gls"     }] : []),
                  ...(settings?.packetaEnabled ? [{ label: "Packeta",     value: "packeta" }] : []),
                  // always include current courier even if not explicitly enabled
                  ...(!settings?.[`${wizardCourier}Enabled`] && wizardCourier
                    ? [{ label: COURIER_MAP[wizardCourier]?.label || wizardCourier, value: wizardCourier }]
                    : []),
                ].filter((v, i, arr) => arr.findIndex(x => x.value === v.value) === i)}
              />

              <Select
                label={loadingServices ? "Tip serviciu (se încarcă...)" : "Tip serviciu"}
                value={wizardService}
                onChange={setWizardService}
                disabled={loadingServices}
                options={
                  (liveServices[wizardCourier] || COURIER_SERVICES[wizardCourier] || [{ label: "Standard", value: "standard" }])
                }
              />

              <TextField
                label="Greutate (kg) — opțional"
                type="number"
                value={wizardWeight}
                onChange={setWizardWeight}
                min="0.1"
                step="0.1"
                suffix="kg"
                placeholder="Lasă gol pentru greutatea din comandă"
              />

              <TextField
                label="Observații — opțional"
                value={wizardObs}
                onChange={setWizardObs}
                multiline={2}
                placeholder="Ex: Fragil, a nu se răsturna"
              />

              {selectedOrders.length > 1 && (
                <Banner tone="info">
                  <Text variant="bodySm">
                    Curirul și serviciul selectat vor fi aplicate tuturor celor {selectedOrders.length} comenzi.
                    Greutatea se va aplica individual doar dacă este specificată.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Fulfill Results Modal */}
      {showFulfillResults && (
        <Modal
          open={showFulfillResults}
          onClose={() => setShowFulfillResults(false)}
          title={t("fulfill_results_title")}
          primaryAction={{ content: t("close"), onAction: () => setShowFulfillResults(false) }}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {fulfillResults.map((r) => (
                <div key={r.orderId} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:"1px solid #f0f0f0" }}>
                  <span style={{ fontSize:18 }}>{r.success ? "✅" : "❌"}</span>
                  <div>
                    <Text fontWeight="semibold">{r.orderName || r.orderId}</Text>
                    {r.success
                      ? <Text tone="subdued">{t("fulfilled_shopify")}</Text>
                      : <Text tone="critical">{r.error}</Text>
                    }
                  </div>
                </div>
              ))}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* AWB Results Modal */}
      {showResults && (
        <Modal
          open={showResults}
          onClose={() => setShowResults(false)}
          title={t("awb_results_title")}
          primaryAction={{ content: t("close"), onAction: () => setShowResults(false) }}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {awbResults.map((r) => (
                <div key={r.orderId} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:"1px solid #f0f0f0" }}>
                  <span style={{ fontSize:18 }}>{r.success ? "✅" : "❌"}</span>
                  <div>
                    <Text fontWeight="semibold">{r.orderName || r.orderId}</Text>
                    {r.success
                      ? <Text tone="subdued">AWB: <code>{r.awbNumber}</code></Text>
                      : <Text tone="critical">{r.error}</Text>
                    }
                  </div>
                </div>
              ))}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* ── Single-order 4-step AWB wizard ─────────────────────────────── */}
      {singleWizardOpen && activeOrder && (() => {
        const swShowPickup = needsPickupPoint(swCourier, swService, swGlsShop);
        const swServiceOpts = liveServices[swCourier] || FULL_COURIER_SERVICES[swCourier] || [{ label: "Standard", value: "standard" }];
        const swSteps = ["Curier", "Destinatar", "Conținut", "Observații"];

        function SwStepIndicator() {
          return (
            <div style={{ display:"flex", borderRadius:6, overflow:"hidden", marginBottom:20, border:"1px solid #ddd" }}>
              {swSteps.map((label, i) => {
                const n = i + 1, active = n === singleWizardStep, done = n < singleWizardStep;
                return (
                  <div key={n} onClick={() => done && setSingleWizardStep(n)} style={{
                    flex:1, padding:"10px 4px", textAlign:"center", fontSize:13,
                    fontWeight: active ? 600 : 400,
                    background: active ? "#008060" : done ? "#00a374" : "#f5f5f5",
                    color: (active || done) ? "#fff" : "#555",
                    cursor: done ? "pointer" : "default",
                    borderRight: i < 3 ? "1px solid rgba(255,255,255,0.25)" : "none",
                    userSelect:"none",
                  }}>{n}. {label}</div>
                );
              })}
            </div>
          );
        }

        function renderSwStep1() {
          return (
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                <div style={{ flex:1 }}>
                  <Select label="Curier" value={swCourier} helpText="Poți suprascrie curierul selectat."
                    onChange={(v) => {
                      setSwCourier(v);
                      const opts = liveServices[v] || FULL_COURIER_SERVICES[v] || [];
                      setSwService(opts[0]?.value || "standard");
                      setSwFanObs([]); setSwOpenPackage(false); setSwSaturday(false);
                      setSwMorning(false); setSwGlsShop(false); setSwSwap(false);
                      setSwPickupPoint(null); setSwPickupPoints([]);
                    }}
                    options={[
                      ...(settings?.fanEnabled     ? [{ label:"FAN Courier", value:"fan"     }] : []),
                      ...(settings?.samedayEnabled ? [{ label:"Sameday",     value:"sameday" }] : []),
                      ...(settings?.cargusEnabled  ? [{ label:"Cargus",      value:"cargus"  }] : []),
                      ...(settings?.glsEnabled     ? [{ label:"GLS",         value:"gls"     }] : []),
                      ...(settings?.packetaEnabled ? [{ label:"Packeta",     value:"packeta" }] : []),
                    ]}
                  />
                </div>
                <div style={{ flex:1 }}>
                  <Select label="Tip serviciu" value={swService} helpText="Selectează serviciul potrivit."
                    onChange={(v) => { setSwService(v); setSwPickupPoint(null); setSwPickupPoints([]);
                      if (needsPickupPoint(swCourier, v, swGlsShop)) loadSwPickupPoints(swCourier);
                    }}
                    options={swServiceOpts}
                  />
                </div>
              </InlineStack>

              {swCourier === "fan" && (
                <InlineStack gap="500" align="start" blockAlign="start">
                  <div style={{ flex:1 }}>
                    <Text variant="bodyMd" fontWeight="semibold">Observații (max 3)</Text>
                    <div style={{ marginTop:8 }}>
                      {FAN_OBSERVATIONS.map((obs) => (
                        <div key={obs} style={{ marginBottom:6 }}>
                          <Checkbox label={obs} checked={swFanObs.includes(obs)}
                            disabled={!swFanObs.includes(obs) && swFanObs.length >= 3}
                            onChange={() => setSwFanObs((p) => p.includes(obs) ? p.filter((x) => x !== obs) : p.length < 3 ? [...p, obs] : p)} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex:1 }}>
                    <Text variant="bodyMd" fontWeight="semibold">Opțiuni</Text>
                    <div style={{ marginTop:8 }}>
                      <div style={{ marginBottom:8 }}><Checkbox label="Livrare sâmbătă" checked={swSaturday} onChange={setSwSaturday} /></div>
                      <div style={{ marginBottom:8 }}><Checkbox label="Deschidere la livrare" checked={swOpenPackage} onChange={setSwOpenPackage} helpText="Destinatarul verifică înainte de a accepta" /></div>
                      <div style={{ marginBottom:8 }}><Checkbox label="Serviciu Swap" checked={swSwap} onChange={setSwSwap} /></div>
                    </div>
                  </div>
                </InlineStack>
              )}

              {swCourier === "cargus" && (
                <InlineStack gap="500" align="start" blockAlign="start">
                  <div style={{ flex:1 }}>
                    <Text variant="bodyMd" fontWeight="semibold">Tip ramburs</Text>
                    <div style={{ marginTop:8 }}>
                      <RadioButton label="Ramburs cash" checked={swCargusReimb === "cash"} id="sw-cash" name="swReimb" onChange={() => setSwCargusReimb("cash")} />
                      <RadioButton label="Ramburs cont colector" checked={swCargusReimb === "account"} id="sw-account" name="swReimb" onChange={() => setSwCargusReimb("account")} />
                    </div>
                  </div>
                  <div style={{ flex:1 }}>
                    <Text variant="bodyMd" fontWeight="semibold">Opțiuni</Text>
                    <div style={{ marginTop:8 }}>
                      <div style={{ marginBottom:8 }}><Checkbox label="Deschidere la livrare" checked={swOpenPackage} onChange={setSwOpenPackage} /></div>
                      <div style={{ marginBottom:8 }}><Checkbox label="Livrare sâmbătă" checked={swSaturday} onChange={setSwSaturday} /></div>
                      <div style={{ marginBottom:8 }}><Checkbox label="Livrare dimineața" checked={swMorning} onChange={setSwMorning} /></div>
                      <div style={{ marginBottom:8 }}><Checkbox label="Serviciu Swap" checked={swSwap} onChange={setSwSwap} /></div>
                    </div>
                  </div>
                </InlineStack>
              )}

              {swCourier === "sameday" && (
                <InlineStack gap="500" align="start" blockAlign="start">
                  <div style={{ flex:1 }}><Checkbox label="Deschidere la livrare" checked={swOpenPackage} onChange={setSwOpenPackage} /></div>
                  <div style={{ flex:1 }}><TextField label="Valoare asigurată (RON)" type="number" value={swInsured} onChange={setSwInsured} min="0" suffix="RON" /></div>
                </InlineStack>
              )}

              {swCourier === "gls" && (
                <InlineStack gap="400" blockAlign="start">
                  <div style={{ flex:1 }}>
                    <Checkbox label="Livrare la ParcelShop / Locker" checked={swGlsShop}
                      onChange={(v) => { setSwGlsShop(v); setSwPickupPoint(null); setSwPickupPoints([]); if (v) loadSwPickupPoints("gls"); }} />
                  </div>
                  <div style={{ flex:1 }}><Checkbox label="Livrare sâmbătă" checked={swSaturday} onChange={setSwSaturday} /></div>
                </InlineStack>
              )}
            </BlockStack>
          );
        }

        function renderSwStep2() {
          const q = swPickupSearch.toLowerCase();
          const filteredPP = swPickupPoints.filter((p) =>
            !q || [p.name, p.city, p.county, p.address].some((f) => (f || "").toLowerCase().includes(q))
          ).slice(0, 30);
          return (
            <BlockStack gap="400">
              {swShowPickup && (
                <BlockStack gap="200">
                  <Text variant="headingSm" fontWeight="semibold">
                    {swCourier === "fan" ? "FANbox *" : swCourier === "gls" ? "GLS ParcelShop *" :
                     swCourier === "cargus" ? "PUDO / Ship & Go *" : swCourier === "sameday" ? "Easybox *" : "Punct de ridicare *"}
                  </Text>
                  {swPickupPoint ? (
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <BlockStack gap="050">
                        <Text variant="bodySm" fontWeight="semibold">{swPickupPoint.name}</Text>
                        <Text variant="bodySm" tone="subdued">{swPickupPoint.address}</Text>
                      </BlockStack>
                      <Button size="micro" onClick={() => { setSwPickupPoint(null); loadSwPickupPoints(swCourier); }}>Schimbă</Button>
                    </InlineStack>
                  ) : (
                    <BlockStack gap="200">
                      <TextField labelHidden label="Caută" placeholder="Caută după oraș, adresă, nume..."
                        value={swPickupSearch} onChange={setSwPickupSearch} autoComplete="off" />
                      {swLoadingPP
                        ? <InlineStack align="center"><Spinner size="small" /></InlineStack>
                        : <div style={{ maxHeight:160, overflowY:"auto", border:"1px solid #e0e0e0", borderRadius:6 }}>
                            {filteredPP.length === 0
                              ? <Box padding="400"><Text tone="subdued" alignment="center">
                                  {swPickupPoints.length === 0 ? "Nicio locație. Sincronizează din Setări." : "Nicio potrivire."}
                                </Text></Box>
                              : filteredPP.map((p) => (
                                  <div key={p.id} role="button" tabIndex={0}
                                    onClick={() => setSwPickupPoint(p)}
                                    onKeyDown={(e) => e.key === "Enter" && setSwPickupPoint(p)}
                                    style={{ padding:"8px 12px", cursor:"pointer", borderBottom:"1px solid #f5f5f5" }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                                    <Text variant="bodySm" fontWeight="semibold">{p.name}</Text>
                                    <br />
                                    <Text variant="bodySm" tone="subdued">
                                      {[p.city, p.county].filter(Boolean).join(", ")}{p.address ? ` — ${p.address}` : ""}
                                    </Text>
                                  </div>
                                ))}
                          </div>
                      }
                    </BlockStack>
                  )}
                  <Divider />
                </BlockStack>
              )}
              <FormLayout>
                <FormLayout.Group>
                  <TextField label="Nume" value={swName} onChange={setSwName} autoComplete="off" />
                  <TextField label="Email" value={swEmail} onChange={setSwEmail} autoComplete="off" type="email" />
                  <TextField label="Telefon" value={swPhone} onChange={setSwPhone} autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Adresă" value={swAddress} onChange={setSwAddress} autoComplete="off" />
                  <TextField label="Detalii adresă (bloc, ap.)" value={swAddrDetails} onChange={setSwAddrDetails} autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Localitate" value={swCity} onChange={setSwCity} autoComplete="off" />
                  <TextField label="Județ" value={swCounty} onChange={setSwCounty} autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Cod poștal" value={swZip} onChange={setSwZip} autoComplete="off" />
                  <TextField label="Țară" value={swCountry} onChange={setSwCountry} autoComplete="off" />
                </FormLayout.Group>
                <TextField label="Companie (opțional)" value={swCompany} onChange={setSwCompany} autoComplete="off" />
              </FormLayout>
            </BlockStack>
          );
        }

        function renderSwStep3() {
          return (
            <BlockStack gap="400">
              <Card background="bg-surface-secondary">
                <Text variant="bodySm" fontWeight="semibold">{activeOrder.shopifyOrderName}</Text>
                <Text variant="bodySm" tone="subdued">Total: {activeOrder.orderTotal > 0 ? `${activeOrder.orderTotal.toFixed(2)} RON` : "—"}</Text>
              </Card>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label="Ramburs (COD)" type="number" value={swCod} onChange={setSwCod} min="0" step="0.01" suffix="RON" />
                  <TextField label="Valoare declarată" type="number" value={swDeclared} onChange={setSwDeclared} min="0" step="0.01" suffix="RON" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <Select label="Plata transportului" value={swPayer} onChange={setSwPayer}
                    options={[{ label:"Destinatar", value:"recipient" }, { label:"Expeditor", value:"sender" }]} />
                  <TextField label="Nr. colete" type="number" value={swPkgCount} onChange={setSwPkgCount} min="1" step="1" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Greutate" type="number" value={swWeight} onChange={setSwWeight} min="0.1" step="0.1" suffix="kg" />
                </FormLayout.Group>
                <Text variant="bodyMd" fontWeight="semibold">Dimensiuni colet</Text>
                <FormLayout.Group>
                  <TextField label="Înălțime" type="number" value={swHeight} onChange={setSwHeight} min="0" suffix="cm" />
                  <TextField label="Lățime" type="number" value={swWidth} onChange={setSwWidth} min="0" suffix="cm" />
                  <TextField label="Lungime" type="number" value={swLength} onChange={setSwLength} min="0" suffix="cm" />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          );
        }

        function renderSwStep4() {
          return (
            <BlockStack gap="400">
              {singleError && <Banner tone="critical" title="Eroare" onDismiss={() => setSingleError(null)}><Text>{singleError}</Text></Banner>}

              {/* Estimated shipping price */}
              <div style={{ background:"#f0faf5", border:"1px solid #b7e4cc", borderRadius:8, padding:"12px 16px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <Text variant="bodySm" fontWeight="semibold">Preț estimat transport</Text>
                  {swEstLoading && <Spinner size="small" />}
                </div>
                {!swEstLoading && swEstPrice && (
                  <div style={{ marginTop:6, display:"flex", alignItems:"baseline", gap:8 }}>
                    <span style={{ fontSize:22, fontWeight:700, color:"#008060" }}>
                      {swEstPrice.price} {swEstPrice.currency || "RON"}
                    </span>
                    <span style={{ fontSize:12, color:"#6d7175" }}>{swEstPrice.courier}</span>
                  </div>
                )}
                {!swEstLoading && !swEstPrice && (
                  <Text variant="bodySm" tone="subdued">Indisponibil pentru acest curier sau lipsesc datele de adresă.</Text>
                )}
              </div>

              <TextField label="Conținut colet / Observații" value={swNotes} onChange={setSwNotes} multiline={4}
                placeholder="Ex: Fragil, a nu se răsturna."
                helpText={swCourier === "fan" && swFanObs.length > 0 ? `Obs. selectate: ${swFanObs.join(", ")}` : undefined}
              />
              <BlockStack gap="300">
                <Checkbox label="Trimite notificare Shopify clientului" checked={swNotify} onChange={setSwNotify}
                  helpText="Shopify trimite email de confirmare livrare" />
                <Checkbox label="Marchează comanda ca expediată" checked={swDispatched} onChange={setSwDispatched}
                  helpText="Setează fulfillment-ul la 'success' în Shopify" />
              </BlockStack>
              <Card background="bg-surface-secondary">
                <BlockStack gap="150">
                  <Text variant="bodySm" fontWeight="semibold">Rezumat</Text>
                  <Text variant="bodySm" tone="subdued">
                    Curier: <strong>{swCourier.toUpperCase()}</strong> · Serviciu: <strong>{swServiceOpts.find((x) => x.value === swService)?.label || swService}</strong>
                  </Text>
                  <Text variant="bodySm" tone="subdued">Destinatar: <strong>{swName}</strong> — {swPhone}</Text>
                  {swShowPickup && swPickupPoint
                    ? <Text variant="bodySm" tone="subdued">📦 {swPickupPoint.name}</Text>
                    : <Text variant="bodySm" tone="subdued">🚚 {swAddress}, {swCity}</Text>
                  }
                  <Text variant="bodySm" tone="subdued">
                    Ramburs: <strong>{parseFloat(swCod) > 0 ? `${parseFloat(swCod).toFixed(2)} RON` : "Nu"}</strong>
                    {" · "}Greutate: <strong>{swWeight} kg</strong>
                    {" · "}Colete: <strong>{swPkgCount}</strong>
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          );
        }

        return (
          <Modal open={singleWizardOpen} onClose={() => setSingleWizardOpen(false)} size="large"
            title={`Generează AWB — ${activeOrder.shopifyOrderName}`}>
            <Modal.Section>
              <SwStepIndicator />
              {singleWizardStep === 1 && renderSwStep1()}
              {singleWizardStep === 2 && renderSwStep2()}
              {singleWizardStep === 3 && renderSwStep3()}
              {singleWizardStep === 4 && renderSwStep4()}
              <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:24, paddingTop:16, borderTop:"1px solid #e0e0e0" }}>
                {singleWizardStep > 1 && <Button onClick={() => setSingleWizardStep((s) => s - 1)}>Anterior</Button>}
                {singleWizardStep < 4
                  ? <Button variant="primary" onClick={() => {
                      if (singleWizardStep === 2 && swShowPickup && !swPickupPoint) {
                        setSingleError("Selectează un punct de ridicare înainte de a continua."); return;
                      }
                      setSingleError(null);
                      const next = singleWizardStep + 1;
                      setSingleWizardStep(next);
                      if (next === 4) estimateShipping();
                    }}>Următor</Button>
                  : <Button variant="primary" tone="success" loading={singleGenerating} onClick={submitSingleWizard}>
                      {singleGenerating ? "Se generează..." : "Generează AWB"}
                    </Button>
                }
              </div>
            </Modal.Section>
          </Modal>
        );
      })()}

      {toastMsg && (
        <Toast content={toastMsg} onDismiss={() => setToastMsg(null)} />
      )}
    </Frame>
  );
}
