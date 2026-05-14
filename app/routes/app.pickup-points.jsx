// app/routes/app.pickup-points.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState, useEffect } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Button, Text,
  BlockStack, Select, TextField, Banner,
  EmptyState, Frame, Toast, Tabs, InlineStack,
} from "@shopify/polaris";

const COURIER_CONFIG = {
  fan:     { label: "FANbox (FAN Courier)", color: "#e65100", badgeTone: "warning",   badgeLabel: "FANbox"   },
  sameday: { label: "Easybox (Sameday)",   color: "#1565c0", badgeTone: "info",       badgeLabel: "Easybox"  },
  cargus:  { label: "Ship&Go (Cargus)",    color: "#c62828", badgeTone: "critical",   badgeLabel: "Cargus"   },
  gls:     { label: "ParcelShop (GLS)",    color: "#f9a825", badgeTone: "attention",  badgeLabel: "GLS"      },
  packeta: { label: "Z-Box (Packeta)",     color: "#8e0000", badgeTone: "new",        badgeLabel: "Packeta"  },
};

const COUNTRY_NAMES = {
  ro: "România", de: "Germania", fr: "Franța", it: "Italia", es: "Spania",
  pl: "Polonia", hu: "Ungaria", cz: "Cehia", sk: "Slovacia", at: "Austria",
  nl: "Olanda", be: "Belgia", se: "Suedia", no: "Norvegia", dk: "Danemarca",
  fi: "Finlanda", ee: "Estonia", lv: "Letonia", lt: "Lituania", pt: "Portugalia",
  gr: "Grecia", bg: "Bulgaria", hr: "Croația", si: "Slovenia", rs: "Serbia",
  ba: "Bosnia", me: "Muntenegru", mk: "Macedonia de Nord", al: "Albania",
  cy: "Cipru", mt: "Malta", lu: "Luxemburg", ch: "Elveția", gb: "Marea Britanie",
  ie: "Irlanda",
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url     = new URL(request.url);
  const courier = url.searchParams.get("courier") || "";
  const county  = url.searchParams.get("county")  || "";
  const country = url.searchParams.get("country") || "";

  const where = {
    isActive: true,
    ...(courier ? { courier }                                                  : {}),
    ...(county  ? { county: { contains: county, mode: "insensitive" } }       : {}),
    ...(country ? { country: country.toLowerCase() }                          : {}),
  };

  // Distinct countries for the currently selected courier (or all couriers)
  const countryRows = await prisma.pickupPoint.findMany({
    where: { isActive: true, ...(courier ? { courier } : {}) },
    select: { country: true },
    distinct: ["country"],
    orderBy: { country: "asc" },
  });

  const [points, total, counts, lastUpdate] = await Promise.all([
    prisma.pickupPoint.findMany({
      where,
      orderBy: [{ country: "asc" }, { county: "asc" }, { name: "asc" }],
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
  const availableCountries = countryRows.map((r) => r.country).filter(Boolean);

  return json({
    points, total, countMap, availableCountries,
    lastUpdate: lastUpdate?.updatedAt,
    filters: { courier, county, country },
  });
}

export async function action({ request }) {
  await authenticate.admin(request);
  const result = await refreshPickupPointsCache();
  return json({ refreshed: true, result });
}

export default function PickupPointsPage() {
  const { points, total, countMap, availableCountries, lastUpdate, filters } = useLoaderData();
  const actionData = useActionData();
  const navigate   = useNavigate();
  const submit     = useSubmit();

  const [courierFilter, setCourierFilter] = useState(filters.courier);
  const [countyFilter,  setCountyFilter]  = useState(filters.county);
  const [countryFilter, setCountryFilter] = useState(filters.country);
  const [refreshing,    setRefreshing]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [selectedTab,   setSelectedTab]   = useState(0);

  const tabCouriers = ["", ...Object.keys(COURIER_CONFIG)];
  const tabLabels   = ["Toți", "FANbox", "Easybox", "Cargus", "GLS", "Packeta"];

  const countryOptions = [
    { label: "Toate țările", value: "" },
    ...availableCountries.map((c) => ({
      label: COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c.toUpperCase()})` : c.toUpperCase(),
      value: c,
    })),
  ];

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

  function applyFilters(courier, county, country) {
    const params = new URLSearchParams();
    if (courier) params.set("courier", courier);
    if (county)  params.set("county",  county);
    if (country) params.set("country", country);
    navigate(`/app/pickup-points?${params}`);
  }

  function handleTabChange(idx) {
    setSelectedTab(idx);
    const next = tabCouriers[idx];
    setCourierFilter(next);
    // Reset country when switching couriers — the available list will refresh
    setCountryFilter("");
    applyFilters(next, countyFilter, "");
  }

  function handleRefresh() {
    setRefreshing(true);
    submit({}, { method: "post" });
    setToast("Reîmprospătare în curs... poate dura 1-2 minute pentru toate țările.");
  }

  const rows = points.map((p) => {
    const cfg = COURIER_CONFIG[p.courier] || { badgeTone: "info", badgeLabel: p.courier };
    const countryLabel = p.country
      ? (COUNTRY_NAMES[p.country] || p.country.toUpperCase())
      : "—";
    return [
      <Badge tone={cfg.badgeTone}>{cfg.badgeLabel}</Badge>,
      p.name,
      countryLabel,
      p.county || "—",
      p.city   || "—",
      p.address,
      p.lat && p.lng
        ? <Text variant="bodySm" tone="subdued">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
        : <Badge tone="critical">Fără coord.</Badge>,
    ];
  });

  const refreshErrors = actionData?.result?.errors || [];

  return (
    <Frame>
      <Page
        title="Puncte de ridicare"
        subtitle={`${total.toLocaleString("ro-RO")} puncte active${filters.country ? ` din ${COUNTRY_NAMES[filters.country] || filters.country.toUpperCase()}` : " din toate țările"}`}
        primaryAction={{
          content: refreshing ? "Se reîmprospătează..." : "Reîmprospătează acum",
          onAction: handleRefresh,
          loading: refreshing,
        }}
        backAction={{ onAction: () => navigate("/app/settings") }}
      >
        <Layout>

          {/* ── Stats cards ──────────────────────────────────────────────── */}
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
                  <Text variant="headingXl" fontWeight="bold">
                    {(countMap[key] ?? 0).toLocaleString("ro-RO")}
                  </Text>
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
                  {Object.values(countMap).reduce((a, b) => a + b, 0).toLocaleString("ro-RO")}
                </Text>
                <Text variant="bodySm" tone="subdued">Total puncte active</Text>
              </div>
            </div>
          </Layout.Section>

          {/* ── Last update + errors ──────────────────────────────────────── */}
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
                  </strong>
                  {" "}— Actualizare automată la 24h. Widget-ul filtrează automat după țara clientului.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {refreshErrors.length > 0 && (
            <Layout.Section>
              <Banner tone="warning" title="Unii curieri nu au putut fi reîmprospătați">
                <BlockStack gap="100">
                  {refreshErrors.map((err, i) => <Text key={i} variant="bodySm">{err}</Text>)}
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {/* ── Tabs + Filters + Table ────────────────────────────────────── */}
          <Layout.Section>
            <Card padding="0">
              <Tabs
                tabs={tabLabels.map((label, i) => ({
                  id: `tab-${i}`,
                  content: i === 0
                    ? `${label} (${Object.values(countMap).reduce((a, b) => a + b, 0).toLocaleString("ro-RO")})`
                    : `${label} (${(countMap[tabCouriers[i]] ?? 0).toLocaleString("ro-RO")})`,
                  panelID: `panel-${i}`,
                }))}
                selected={selectedTab}
                onSelect={handleTabChange}
              />

              <div style={{ padding: "16px 20px" }}>
                <BlockStack gap="400">
                  {/* Filters row */}
                  <InlineStack gap="300" align="end" blockAlign="end" wrap>
                    <div style={{ flex: "2 1 180px" }}>
                      <Select
                        label="Filtrează după țară"
                        options={countryOptions}
                        value={countryFilter}
                        onChange={(val) => {
                          setCountryFilter(val);
                          applyFilters(courierFilter, countyFilter, val);
                        }}
                      />
                    </div>
                    <div style={{ flex: "2 1 180px" }}>
                      <TextField
                        label="Filtrează după județ"
                        value={countyFilter}
                        onChange={setCountyFilter}
                        placeholder="ex: Cluj, Prahova..."
                        onKeyDown={(e) => e.key === "Enter" && applyFilters(courierFilter, countyFilter, countryFilter)}
                        clearButton
                        onClearButtonClick={() => {
                          setCountyFilter("");
                          applyFilters(courierFilter, "", countryFilter);
                        }}
                      />
                    </div>
                    <div style={{ paddingTop: 24 }}>
                      <Button onClick={() => applyFilters(courierFilter, countyFilter, countryFilter)} variant="primary">
                        Filtrează
                      </Button>
                    </div>
                  </InlineStack>

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
                          : "Configurează credențialele curierilor în Setări, apoi apasă \"Reîmprospătează acum\"."
                        }
                      </p>
                      <Button onClick={() => navigate("/app/settings")}>Mergi la Setări</Button>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={["text","text","text","text","text","text","text"]}
                      headings={["Curier","Nume","Țară","Județ","Localitate","Adresă","Coordonate"]}
                      rows={rows}
                      hasZebraStripingOnData
                      increasedTableDensity
                      footerContent={`Afișând ${points.length.toLocaleString("ro-RO")} din ${total.toLocaleString("ro-RO")} puncte${filters.country ? ` din ${COUNTRY_NAMES[filters.country] || filters.country.toUpperCase()}` : ""}`}
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
