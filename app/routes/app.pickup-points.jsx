// app/routes/app.pickup-points.jsx
// Admin view of all cached pickup points — useful for debugging
// and for merchants to see what locations are available.

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState, useEffect } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Button, Text,
  BlockStack, Select, TextField, Banner,
  EmptyState, Frame, Toast, Tabs,
} from "@shopify/polaris";

const COURIER_CONFIG = {
  fan:     { label: "FANbox (FAN Courier)", color: "#e65100", badgeTone: "warning",   badgeLabel: "FANbox"   },
  sameday: { label: "Easybox (Sameday)",   color: "#1565c0", badgeTone: "info",       badgeLabel: "Easybox"  },
  cargus:  { label: "Ship&Go (Cargus)",    color: "#c62828", badgeTone: "critical",   badgeLabel: "Cargus"   },
  gls:     { label: "ParcelShop (GLS)",    color: "#f9a825", badgeTone: "attention",  badgeLabel: "GLS"      },
  packeta: { label: "Z-Box (Packeta)",     color: "#8e0000", badgeTone: "new",        badgeLabel: "Packeta"  },
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const courier = url.searchParams.get("courier") || "";
  const county  = url.searchParams.get("county")  || "";

  const where = {
    isActive: true,
    ...(courier ? { courier } : {}),
    ...(county  ? { county: { contains: county, mode: "insensitive" } } : {}),
  };

  const [points, total, counts, lastUpdate] = await Promise.all([
    prisma.pickupPoint.findMany({
      where,
      orderBy: [{ county: "asc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.pickupPoint.count({ where }),
    Promise.all(
      Object.keys(COURIER_CONFIG).map(async (c) => ({
        courier: c,
        count: await prisma.pickupPoint.count({ where: { courier: c, isActive: true } }),
      }))
    ),
    prisma.pickupPoint.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const countMap = Object.fromEntries(counts.map(({ courier, count }) => [courier, count]));

  return json({
    points, total, countMap,
    lastUpdate: lastUpdate?.updatedAt,
    filters: { courier, county },
  });
}

export async function action({ request }) {
  await authenticate.admin(request);
  try {
    const result = await refreshPickupPointsCache();
    return json({ refreshed: true, result });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}

export default function PickupPointsPage() {
  const { points, total, countMap, lastUpdate, filters } = useLoaderData();
  const actionData = useActionData();
  const navigate   = useNavigate();
  const submit     = useSubmit();

  const [courierFilter, setCourierFilter] = useState(filters.courier);
  const [countyFilter,  setCountyFilter]  = useState(filters.county);
  const [refreshing,    setRefreshing]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [selectedTab,   setSelectedTab]   = useState(0);

  // Map tab index → courier key (0 = all)
  const tabCouriers = ["", ...Object.keys(COURIER_CONFIG)];
  const tabLabels   = ["Toți", "FANbox", "Easybox", "Cargus", "GLS", "Packeta"];

  // Show result toast after refresh
  useEffect(() => {
    if (actionData?.refreshed) {
      const r = actionData.result;
      const parts = Object.keys(COURIER_CONFIG)
        .map((c) => `${COURIER_CONFIG[c].badgeLabel}: ${r[c] ?? 0}`)
        .join(", ");
      const msg = `Reîmprospătat! ${parts}${r.errors?.length ? ` | Erori: ${r.errors.join("; ")}` : ""}`;
      setToast(msg);
      setRefreshing(false);
      navigate("/app/pickup-points");
    }
    if (actionData?.error) {
      setToast(`Eroare: ${actionData.error}`);
      setRefreshing(false);
    }
  }, [actionData]);

  function applyFilters(courier, county) {
    const params = new URLSearchParams();
    if (courier) params.set("courier", courier);
    if (county)  params.set("county",  county);
    navigate(`/app/pickup-points?${params}`);
  }

  function handleTabChange(idx) {
    setSelectedTab(idx);
    setCourierFilter(tabCouriers[idx]);
    applyFilters(tabCouriers[idx], countyFilter);
  }

  function handleRefresh() {
    setRefreshing(true);
    submit({}, { method: "post" });
    setToast("Reîmprospătare în curs... poate dura 30-60 secunde.");
  }

  const rows = points.map((p) => {
    const cfg = COURIER_CONFIG[p.courier] || { badgeTone: "info", badgeLabel: p.courier };
    return [
      <Badge tone={cfg.badgeTone}>{cfg.badgeLabel}</Badge>,
      p.name,
      p.county || "—",
      p.city   || "—",
      p.address,
      p.lat && p.lng
        ? <Text variant="bodySm" tone="subdued">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
        : <Badge tone="critical">Fără coord.</Badge>,
    ];
  });

  // Errors from last refresh (shown if available in actionData)
  const refreshErrors = actionData?.result?.errors || [];

  return (
    <Frame>
      <Page
        title="Puncte de ridicare"
        subtitle={`${total} puncte active în baza de date`}
        primaryAction={{
          content: refreshing ? "Se reîmprospătează..." : "🔄 Reîmprospătează acum",
          onAction: handleRefresh,
          loading: refreshing,
        }}
        backAction={{ onAction: () => navigate("/app/settings") }}
      >
        <Layout>

          {/* ── Stats ─────────────────────────────────────────────────── */}
          <Layout.Section>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(COURIER_CONFIG).map(([key, cfg]) => (
                <div
                  key={key}
                  onClick={() => {
                    const idx = tabCouriers.indexOf(key);
                    if (idx >= 0) handleTabChange(idx);
                  }}
                  style={{
                    flex: "1 1 140px", background: "#fff",
                    border: "1px solid #e1e3e5",
                    borderTop: `4px solid ${cfg.color}`,
                    borderRadius: 12, padding: "14px 18px",
                    cursor: "pointer",
                    opacity: countMap[key] === 0 ? 0.5 : 1,
                  }}
                >
                  <Text variant="headingXl" fontWeight="bold">{countMap[key] ?? 0}</Text>
                  <Text variant="bodySm" tone="subdued">{cfg.label}</Text>
                </div>
              ))}
              <div style={{
                flex: "1 1 140px", background: "#fff",
                border: "1px solid #e1e3e5",
                borderTop: "4px solid #108043",
                borderRadius: 12, padding: "14px 18px",
              }}>
                <Text variant="headingXl" fontWeight="bold">
                  {Object.values(countMap).reduce((a, b) => a + b, 0)}
                </Text>
                <Text variant="bodySm" tone="subdued">Total puncte active</Text>
              </div>
            </div>
          </Layout.Section>

          {/* ── Last update + errors ──────────────────────────────────── */}
          {lastUpdate && (
            <Layout.Section>
              <Banner tone="info">
                <Text>
                  Ultima actualizare:{" "}
                  <strong>
                    {new Date(lastUpdate).toLocaleDateString("ro-RO", {
                      day: "2-digit", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </strong>{" "}
                  — Actualizare automată la 24h.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {refreshErrors.length > 0 && (
            <Layout.Section>
              <Banner tone="warning" title="Unii curieri nu au putut fi reîmprospătați">
                <BlockStack gap="100">
                  {refreshErrors.map((err, i) => (
                    <Text key={i} variant="bodySm">{err}</Text>
                  ))}
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {(courierFilter === "gls" || selectedTab === tabCouriers.indexOf("gls")) && (
            <Layout.Section>
              <Banner tone="info" title="GLS ParcelShop — limitare API">
                <Text>
                  API-ul MyGLS Romania (<code>ParcelService.svc</code>) nu include un endpoint pentru listarea ParcelShop-urilor — confirmat din WSDL-ul oficial.
                  Livrarea la ParcelShop GLS <strong>funcționează</strong> la generarea AWB (cod serviciu AOS), dar lista de locații nu poate fi sincronizată automat.
                  Contactează GLS Romania pentru a obține o metodă de export al locațiilor ParcelShop.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {/* ── Tabs + Table ─────────────────────────────────────────── */}
          <Layout.Section>
            <Card padding="0">
              <Tabs
                tabs={tabLabels.map((label, i) => ({
                  id: `tab-${i}`,
                  content: i === 0
                    ? `${label} (${Object.values(countMap).reduce((a, b) => a + b, 0)})`
                    : `${label} (${countMap[tabCouriers[i]] ?? 0})`,
                  panelID: `panel-${i}`,
                }))}
                selected={selectedTab}
                onSelect={handleTabChange}
              />

              <div style={{ padding: "16px 20px" }}>
                <BlockStack gap="400">
                  {/* County filter */}
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                    <div style={{ flex: "2 1 200px" }}>
                      <TextField
                        label="Filtrează după județ"
                        value={countyFilter}
                        onChange={setCountyFilter}
                        placeholder="ex: Cluj, Prahova..."
                        onKeyDown={(e) => e.key === "Enter" && applyFilters(courierFilter, countyFilter)}
                        clearButton
                        onClearButtonClick={() => {
                          setCountyFilter("");
                          applyFilters(courierFilter, "");
                        }}
                      />
                    </div>
                    <div style={{ paddingTop: 24 }}>
                      <Button onClick={() => applyFilters(courierFilter, countyFilter)} variant="primary">
                        Filtrează
                      </Button>
                    </div>
                  </div>

                  {points.length === 0 ? (
                    <EmptyState
                      heading={
                        tabCouriers[selectedTab]
                          ? `Niciun punct ${COURIER_CONFIG[tabCouriers[selectedTab]]?.badgeLabel || ""}`
                          : "Niciun punct de ridicare"
                      }
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>
                        {tabCouriers[selectedTab]
                          ? `Verifică că ${COURIER_CONFIG[tabCouriers[selectedTab]]?.label} este activat și credențialele sunt corecte în Setări, apoi apasă "Reîmprospătează acum".`
                          : `Configurează credențialele curierilor în Setări, apoi apasă "Reîmprospătează acum".`
                        }
                      </p>
                      <Button onClick={() => navigate("/app/settings")}>Mergi la Setări</Button>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={["text","text","text","text","text","text"]}
                      headings={["Curier","Nume","Județ","Localitate","Adresă","Coordonate"]}
                      rows={rows}
                      hasZebraStripingOnData
                      increasedTableDensity
                      footerContent={`Afișând ${points.length} din ${total} puncte`}
                    />
                  )}
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>

        </Layout>
      </Page>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={6000} />}
    </Frame>
  );
}
