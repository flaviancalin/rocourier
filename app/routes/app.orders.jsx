// app/routes/app.orders.jsx
// Full orders page — filterable, searchable, with bulk AWB generation

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { getOrders } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Button, Text,
  BlockStack, InlineStack, Select, TextField,
  Pagination, Modal, Banner, Checkbox, EmptyState,
  Toast, Frame,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  let shop = session.shop;
  const token = session.accessToken;

  if (!shop && token) {
    const found = await prisma.session.findFirst({ where: { accessToken: token } });
    if (found) shop = found.shop;
  }

  if (!shop) {
    return json({ orders: [], total: 0, totalPages: 1, page: 1, filters: { status: "", courier: "", method: "", search: "" } });
  }

  // Silent background sync
  try {
    const res = await fetch(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&fields=id,name,created_at,note_attributes,shipping_address,customer,total_price`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (res.ok) {
      const { orders: shopifyOrders } = await res.json();
      for (const o of shopifyOrders || []) {
        const attrs = {};
        (o.note_attributes || []).forEach((a) => { attrs[a.name] = a.value; });

        const method  = attrs["_rc_method"]   || attrs["_rocourier_method"]   || "home_delivery";
        const courier = attrs["_rc_courier"]  || attrs["_rocourier_courier"]  || "fan";
        const pid     = attrs["_rc_point_id"] || attrs["_rocourier_point_id"] || null;
        const pname   = attrs["_rc_point_name"]    || attrs["_rocourier_point_name"]    || null;
        const paddr   = attrs["_rc_point_address"] || attrs["_rocourier_point_address"] || null;

        const data = {
          shopifyOrderName:    o.name,
          customerName:        [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(" ") || o.customer?.first_name || "Unknown",
          customerPhone:       o.shipping_address?.phone || o.customer?.phone || "",
          customerEmail:       o.customer?.email || "",
          shippingAddress1:    o.shipping_address?.address1 || "",
          shippingCity:        o.shipping_address?.city || "",
          shippingCounty:      o.shipping_address?.province || "",
          shippingZip:         o.shipping_address?.zip || "",
          shippingCountry:     o.shipping_address?.country_code || "RO",
          shippingMethod:      method,
          courierType:         courier,
          pickupPointId:       pid,
          pickupPointName:     pname,
          pickupPointAddress:  paddr,
          codAmount:           parseFloat(o.total_price) || 0,
          orderTotal:          parseFloat(o.total_price) || 0,
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
            shippingMethod:     data.shippingMethod,
            courierType:        data.courierType,
            pickupPointId:      data.pickupPointId,
            pickupPointName:    data.pickupPointName,
            pickupPointAddress: data.pickupPointAddress,
            codAmount:          data.codAmount,
            orderTotal:         data.orderTotal,
          },
          create: { shop, shopifyOrderId: String(o.id), awbStatus: "pending", ...data },
        });
      }
    }
  } catch (_) {}

  const page    = parseInt(url.searchParams.get("page")    || "1");
  const status  = url.searchParams.get("status")  || "";
  const courier = url.searchParams.get("courier") || "";
  const method  = url.searchParams.get("method")  || "";
  const search  = url.searchParams.get("search")  || "";

  const result = await getOrders({
    shop,
    page,
    perPage: 25,
    status:  status  || null,
    courier: courier || null,
    method:  method  || null,
    search:  search  || null,
  });

  return json({ ...result, filters: { status, courier, method, search } });
}

// ─── Static courier map (brand names, no translation needed) ─────────────────
const COURIER_MAP = {
  fan:     { label: "FAN Courier", color: "#e65100" },
  sameday: { label: "Sameday",     color: "#1565c0" },
  cargus:  { label: "Cargus",      color: "#c62828" },
  gls:     { label: "GLS",         color: "#f9a825" },
  packeta: { label: "Packeta",     color: "#ba000d" },
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
  const { orders, total, totalPages, page, filters } = useLoaderData();
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

  async function generateSelectedAwbs() {
    if (selectedOrders.length === 0) return;
    setGeneratingAwb(true);
    setAwbResults([]);

    const results = [];
    for (const orderId of selectedOrders) {
      try {
        const res = await fetch("/api/generate-awb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
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

  // ── Table rows ─────────────────────────────────────────────────────────────
  const rows = orders.map((o) => {
    const tone       = STATUS_TONES[o.awbStatus] || "default";
    const courierCfg = COURIER_MAP[o.courierType] || { label: o.courierType, color: "#888" };

    return [
      <Checkbox label="" labelHidden checked={selectedOrders.includes(o.id)} onChange={() => toggleSelect(o.id)} />,
      <Button variant="plain" onClick={() => navigate(`/app/orders/${o.id}`)}>
        <strong>{o.shopifyOrderName}</strong>
      </Button>,
      o.customerName || "—",
      <span style={{
        display:"inline-block", padding:"2px 8px", borderRadius:12, fontSize:12,
        fontWeight:600, background:`${courierCfg.color}22`, color:courierCfg.color,
        border:`1px solid ${courierCfg.color}44`,
      }}>
        {courierCfg.label}
      </span>,
      o.shippingMethod === "pickup_point"
        ? `📦 ${o.pickupPointName || t("pickup_short")}`
        : `🚚 ${t("at_home")}`,
      o.awbNumber
        ? <code style={{ fontSize:12, background:"#f4f6f8", padding:"2px 6px", borderRadius:4 }}>{o.awbNumber}</code>
        : <Text tone="subdued">—</Text>,
      <Badge tone={tone}>{t(`status_${o.awbStatus}`) || o.awbStatus}</Badge>,
      o.codAmount > 0
        ? <Text fontWeight="semibold">{o.codAmount.toFixed(2)} RON</Text>
        : <Text tone="subdued">—</Text>,
      new Date(o.createdAt).toLocaleDateString("ro-RO", { day:"2-digit", month:"2-digit", year:"numeric" }),
    ];
  });

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

          {/* Table */}
          <Layout.Section>
            <Card>
              {orders.length === 0 ? (
                <EmptyState
                  heading={t("no_orders_found")}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>{t("no_orders_hint")}</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Button variant="plain" onClick={selectAll}>
                      {selectedOrders.length === orders.length ? t("deselect_all") : t("select_all")}
                    </Button>
                    {selectedOrders.length > 0 && (
                      <Text tone="subdued">{selectedOrders.length} {t("selected")}</Text>
                    )}
                  </InlineStack>

                  {selectedOrders.length > 0 && (
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", padding:"8px 0", borderTop:"1px solid #f0f0f0", borderBottom:"1px solid #f0f0f0" }}>
                      <Button variant="primary" tone="success" loading={generatingAwb} onClick={generateSelectedAwbs}>
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

                      <Button onClick={handlePackingSlip}>
                        {t("packing_slip", { n: selectedOrders.length })}
                      </Button>

                      <Button variant="plain" onClick={() => setSelectedOrders([])}>
                        {t("cancel_selection")}
                      </Button>
                    </div>
                  )}

                  <DataTable
                    columnContentTypes={["text","text","text","text","text","text","text","numeric","text"]}
                    headings={[
                      "", t("col_order"), t("col_customer"), t("col_courier"),
                      t("col_delivery"), t("col_awb"), t("col_status"),
                      t("col_cod"), t("col_date"),
                    ]}
                    rows={rows}
                    hasZebraStripingOnData
                    increasedTableDensity
                  />

                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      hasNext={page < totalPages}
                      onPrevious={() => navigate(`/app/orders?page=${page - 1}`)}
                      onNext={() => navigate(`/app/orders?page=${page + 1}`)}
                      label={t("page_label", { p: page, t: totalPages })}
                    />
                  </InlineStack>
                </BlockStack>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

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

      {toastMsg && (
        <Toast content={toastMsg} onDismiss={() => setToastMsg(null)} />
      )}
    </Frame>
  );
}
