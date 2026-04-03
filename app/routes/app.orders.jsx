// app/routes/app.orders.jsx
// Full orders page — filterable, searchable, with bulk AWB generation

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { getOrders } from "../models/order.server.js";
import { prisma } from "../db.server.js";
import { useState, useCallback } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Button, Text,
  BlockStack, InlineStack, Filters, Select, TextField,
  Pagination, Modal, Spinner, Banner, Checkbox, EmptyState,
  Toast, Frame,
} from "@shopify/polaris";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shop = session.shop;
  const token = session.accessToken;

  // Sync latest orders from Shopify API into our DB
  try {
    const res = await fetch(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=50&fields=id,name,created_at,note_attributes,shipping_address,customer,total_price`,
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
          update: { shippingMethod: data.shippingMethod, courierType: data.courierType, pickupPointId: data.pickupPointId, pickupPointName: data.pickupPointName, pickupPointAddress: data.pickupPointAddress, codAmount: data.codAmount },
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

// ─── Status / courier maps ────────────────────────────────────────────────────
const STATUS_MAP = {
  pending:          { label: "În așteptare",    tone: "warning"   },
  generated:        { label: "AWB generat",     tone: "info"      },
  picked_up:        { label: "Preluat curier",  tone: "info"      },
  in_transit:       { label: "În tranzit",      tone: "attention" },
  out_for_delivery: { label: "La livrare",      tone: "success"   },
  delivered:        { label: "Livrat",          tone: "success"   },
  returned:         { label: "Retur",           tone: "critical"  },
  failed:           { label: "Eșuat",           tone: "critical"  },
};

const COURIER_MAP = {
  fan:     { label: "FAN Courier", color: "#e65100" },
  sameday: { label: "Sameday",     color: "#1565c0" },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { orders, total, totalPages, page, filters } = useLoaderData();
  const navigate = useNavigate();
  const submit   = useSubmit();

  const [selectedOrders, setSelectedOrders] = useState([]);
  const [generatingAwb, setGeneratingAwb]   = useState(false);
  const [awbResults, setAwbResults]         = useState([]);
  const [showResults, setShowResults]       = useState(false);
  const [toastMsg, setToastMsg]             = useState(null);

  // ── Filters ────────────────────────────────────────────────────────────────
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

  // ── Selection ──────────────────────────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const selectAll = () =>
    setSelectedOrders(
      selectedOrders.length === orders.length ? [] : orders.map((o) => o.id)
    );

  // ── Bulk AWB generation ───────────────────────────────────────────────────
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
    // Reload to show updated AWB numbers
    setTimeout(() => navigate(window.location.pathname + window.location.search), 1500);
  }

  // ── Table rows ─────────────────────────────────────────────────────────────
  const rows = orders.map((o) => {
    const statusCfg  = STATUS_MAP[o.awbStatus]   || { label: o.awbStatus,  tone: "default" };
    const courierCfg = COURIER_MAP[o.courierType] || { label: o.courierType, color: "#888" };

    return [
      <Checkbox
        label="" labelHidden
        checked={selectedOrders.includes(o.id)}
        onChange={() => toggleSelect(o.id)}
      />,
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
        ? `📦 ${o.pickupPointName || "Punct fix"}`
        : "🚚 Acasă",
      o.awbNumber
        ? <code style={{ fontSize:12, background:"#f4f6f8", padding:"2px 6px", borderRadius:4 }}>
            {o.awbNumber}
          </code>
        : <Text tone="subdued">—</Text>,
      <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>,
      o.codAmount > 0
        ? <Text fontWeight="semibold">{o.codAmount.toFixed(2)} RON</Text>
        : <Text tone="subdued">—</Text>,
      new Date(o.createdAt).toLocaleDateString("ro-RO", {
        day:"2-digit", month:"2-digit", year:"numeric",
      }),
    ];
  });

  return (
    <Frame>
      <Page
        title="Comenzi"
        subtitle={`${total} comenzi totale`}
        primaryAction={
          selectedOrders.length > 0
            ? {
                content: generatingAwb
                  ? "Se generează..."
                  : `Generează AWB (${selectedOrders.length})`,
                onAction: generateSelectedAwbs,
                loading: generatingAwb,
                tone: "success",
              }
            : undefined
        }
        secondaryActions={
          selectedOrders.length > 0
            ? [{ content: "Anulează selecția", onAction: () => setSelectedOrders([]) }]
            : []
        }
      >
        <Layout>
          {/* ── Filters ────────────────────────────────────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
                  <div style={{ flex:"2 1 220px" }}>
                    <TextField
                      label="Caută"
                      placeholder="Număr comandă, client, AWB..."
                      value={searchVal}
                      onChange={setSearchVal}
                      onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                      clearButton
                      onClearButtonClick={() => { setSearchVal(""); }}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label="Status"
                      value={statusVal}
                      onChange={setStatusVal}
                      options={[
                        { label: "Toate statusurile", value: "" },
                        { label: "În așteptare",      value: "pending" },
                        { label: "AWB generat",       value: "generated" },
                        { label: "În tranzit",        value: "in_transit" },
                        { label: "Livrat",            value: "delivered" },
                        { label: "Retur",             value: "returned" },
                      ]}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label="Curier"
                      value={courierVal}
                      onChange={setCourierVal}
                      options={[
                        { label: "Toți curierii",  value: "" },
                        { label: "FAN Courier",    value: "fan" },
                        { label: "Sameday",        value: "sameday" },
                      ]}
                    />
                  </div>
                  <div style={{ flex:"1 1 150px" }}>
                    <Select
                      label="Metodă"
                      value={methodVal}
                      onChange={setMethodVal}
                      options={[
                        { label: "Toate metodele",  value: "" },
                        { label: "Livrare acasă",   value: "home_delivery" },
                        { label: "Punct ridicare",  value: "pickup_point" },
                      ]}
                    />
                  </div>
                  <div style={{ display:"flex", gap:8, paddingTop:24 }}>
                    <Button onClick={applyFilters} variant="primary">Filtrează</Button>
                    <Button onClick={clearFilters}>Resetează</Button>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Table ──────────────────────────────────────────────────── */}
          <Layout.Section>
            <Card>
              {orders.length === 0 ? (
                <EmptyState
                  heading="Nicio comandă găsită"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Schimbă filtrele sau așteaptă comenzi noi.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Button variant="plain" onClick={selectAll}>
                      {selectedOrders.length === orders.length ? "Deselectează tot" : "Selectează tot"}
                    </Button>
                    {selectedOrders.length > 0 && (
                      <Text tone="subdued">{selectedOrders.length} selectate</Text>
                    )}
                  </InlineStack>

                  <DataTable
                    columnContentTypes={["text","text","text","text","text","text","text","numeric","text"]}
                    headings={["","Comandă","Client","Curier","Livrare","AWB","Status","Ramburs","Dată"]}
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
                      label={`Pagina ${page} din ${totalPages}`}
                    />
                  </InlineStack>
                </BlockStack>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {/* ── AWB Results Modal ────────────────────────────────────────────── */}
      {showResults && (
        <Modal
          open={showResults}
          onClose={() => setShowResults(false)}
          title="Rezultate generare AWB"
          primaryAction={{ content: "Închide", onAction: () => setShowResults(false) }}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {awbResults.map((r) => (
                <div key={r.orderId} style={{
                  display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                  borderBottom:"1px solid #f0f0f0",
                }}>
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
