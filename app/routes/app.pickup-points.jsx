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
import { useTranslation } from "../context/i18n.jsx";

const COURIER_CONFIG = {
  fan:     { label: "FANbox (FAN Courier)", color: "#e65100", badgeTone: "warning",   badgeLabel: "FANbox"   },
  sameday: { label: "Easybox (Sameday)",   color: "#1565c0", badgeTone: "info",       badgeLabel: "Easybox"  },
  cargus:  { label: "Ship&Go (Cargus)",    color: "#c62828", badgeTone: "critical",   badgeLabel: "Cargus"   },
  gls:     { label: "ParcelShop (GLS)",    color: "#f9a825", badgeTone: "attention",  badgeLabel: "GLS"      },
  packeta: { label: "Z-Box (Packeta)",     color: "#8e0000", badgeTone: "new",        badgeLabel: "Packeta"  },
};

const LOCALE_MAP = { ro: "ro-RO", en: "en-US", de: "de-DE", hu: "hu-HU", cs: "cs-CZ" };

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
  const { t, lang } = useTranslation();

  const locale = LOCALE_MAP[lang] || "en-US";

  const getCountryName = (code) => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) || code.toUpperCase();
    } catch (_) {
      return code.toUpperCase();
    }
  };

  const [courierFilter, setCourierFilter] = useState(filters.courier);
  const [countyFilter,  setCountyFilter]  = useState(filters.county);
  const [countryFilter, setCountryFilter] = useState(filters.country);
  const [refreshing,    setRefreshing]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [selectedTab,   setSelectedTab]   = useState(0);

  const tabCouriers = ["", ...Object.keys(COURIER_CONFIG)];
  const tabLabels   = [t("all_tab"), "FANbox", "Easybox", "Cargus", "GLS", "Packeta"];

  const countryOptions = [
    { label: t("all_countries"), value: "" },
    ...availableCountries.map((c) => ({
      label: `${getCountryName(c)} (${c.toUpperCase()})`,
      value: c,
    })),
  ];

  useEffect(() => {
    if (actionData?.refreshed) {
      const r = actionData.result;
      const parts = Object.keys(COURIER_CONFIG)
        .map((c) => `${COURIER_CONFIG[c].badgeLabel}: ${r[c] ?? 0}`)
        .join(", ");
      const msg = `${t("refresh_now").replace("🔄 ", "")} ${parts}${r.errors?.length ? ` | ${t("error")}: ${r.errors.join("; ")}` : ""}`;
      setToast(msg);
      setRefreshing(false);
      navigate("/app/pickup-points");
    }
    if (actionData?.error) {
      setToast(`${t("error")}: ${actionData.error}`);
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
    setToast(t("refresh_in_progress"));
  }

  const rows = points.map((p) => {
    const cfg = COURIER_CONFIG[p.courier] || { badgeTone: "info", badgeLabel: p.courier };
    const countryLabel = p.country ? getCountryName(p.country) : "—";
    return [
      <Badge tone={cfg.badgeTone}>{cfg.badgeLabel}</Badge>,
      p.name,
      countryLabel,
      p.county || "—",
      p.city   || "—",
      p.address,
      p.lat && p.lng
        ? <Text variant="bodySm" tone="subdued">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
        : <Badge tone="critical">{t("no_coords")}</Badge>,
    ];
  });

  const refreshErrors = actionData?.result?.errors || [];

  return (
    <Frame>
      <Page
        title={t("pickup_points_title")}
        subtitle={t("pickup_points_sub", { n: total.toLocaleString(locale) }) + (filters.country ? ` (${getCountryName(filters.country)})` : "")}
        primaryAction={{
          content: refreshing ? t("refreshing") : t("refresh_now"),
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
                    {(countMap[key] ?? 0).toLocaleString(locale)}
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
                  {Object.values(countMap).reduce((a, b) => a + b, 0).toLocaleString(locale)}
                </Text>
                <Text variant="bodySm" tone="subdued">{t("total_active")}</Text>
              </div>
            </div>
          </Layout.Section>

          {/* ── Last update + errors ──────────────────────────────────────── */}
          {lastUpdate && (
            <Layout.Section>
              <Banner tone="info">
                <Text>
                  {t("last_update")}{" "}
                  <strong>
                    {new Date(lastUpdate).toLocaleDateString(locale, {
                      day: "2-digit", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </strong>
                  {" "}— {t("auto_refresh_extended")}
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {refreshErrors.length > 0 && (
            <Layout.Section>
              <Banner tone="warning" title={t("refresh_partial_error")}>
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
                    ? `${label} (${Object.values(countMap).reduce((a, b) => a + b, 0).toLocaleString(locale)})`
                    : `${label} (${(countMap[tabCouriers[i]] ?? 0).toLocaleString(locale)})`,
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
                        label={t("filter_country")}
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
                        label={t("filter_county")}
                        value={countyFilter}
                        onChange={setCountyFilter}
                        placeholder={t("filter_county_ph")}
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
                        {t("filter")}
                      </Button>
                    </div>
                  </InlineStack>

                  {points.length === 0 ? (
                    <EmptyState
                      heading={
                        tabCouriers[selectedTab]
                          ? `${t("no_pickup_points")} — ${COURIER_CONFIG[tabCouriers[selectedTab]]?.badgeLabel || ""}`
                          : t("no_pickup_points")
                      }
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>
                        {tabCouriers[selectedTab]
                          ? `${COURIER_CONFIG[tabCouriers[selectedTab]]?.label}`
                          : t("go_settings")
                        }
                      </p>
                      <Button onClick={() => navigate("/app/settings")}>{t("go_settings")}</Button>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={["text","text","text","text","text","text","text"]}
                      headings={[t("col_courier"), t("col_name"), t("col_country"), t("col_county"), t("col_city"), t("col_address"), t("col_coords")]}
                      rows={rows}
                      hasZebraStripingOnData
                      increasedTableDensity
                      footerContent={t("showing_points", { n: points.length.toLocaleString(locale), t: total.toLocaleString(locale) }) + (filters.country ? ` (${getCountryName(filters.country)})` : "")}
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
