// app/routes/app.pickup-points.jsx
// Admin view of all cached pickup points — useful for debugging
// and for merchants to see what locations are available.

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, DataTable, Badge, Button, Text,
  BlockStack, InlineStack, Select, TextField, Banner,
  EmptyState, Spinner, Frame, Toast,
} from "@shopify/polaris";

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

  const [points, total, fanCount, samedayCount, lastUpdate] = await Promise.all([
    prisma.pickupPoint.findMany({
      where,
      orderBy: [{ county: "asc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.pickupPoint.count({ where }),
    prisma.pickupPoint.count({ where: { courier: "fan",     isActive: true } }),
    prisma.pickupPoint.count({ where: { courier: "sameday", isActive: true } }),
    prisma.pickupPoint.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return json({
    points, total, fanCount, samedayCount,
    lastUpdate: lastUpdate?.updatedAt,
    filters: { courier, county },
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });

  if (!settings) return json({ error: "Settings not configured" }, { status: 400 });

  try {
    const result = await refreshPickupPointsCache({ settings });
    return json({ refreshed: true, result });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}

export default function PickupPointsPage() {
  const { points, total, fanCount, samedayCount, lastUpdate, filters } = useLoaderData();
  const navigate = useNavigate();
  const submit   = useSubmit();

  const [courierFilter, setCourierFilter] = useState(filters.courier);
  const [countyFilter,  setCountyFilter]  = useState(filters.county);
  const [refreshing,    setRefreshing]    = useState(false);
  const [toast,         setToast]         = useState(null);

  function applyFilters() {
    const params = new URLSearchParams();
    if (courierFilter) params.set("courier", courierFilter);
    if (countyFilter)  params.set("county",  countyFilter);
    navigate(`/app/pickup-points?${params}`);
  }

  async function handleRefresh() {
    setRefreshing(true);
    submit({}, { method: "post" });
    setToast("Reîmprospătare în curs... poate dura 30-60 secunde.");
    setTimeout(() => {
      setRefreshing(false);
      navigate("/app/pickup-points");
    }, 5000);
  }

  const rows = points.map((p) => [
    <Badge tone={p.courier === "fan" ? "warning" : "info"}>
      {p.courier === "fan" ? "FANbox" : "easybox"}
    </Badge>,
    p.name,
    p.county || "—",
    p.city   || "—",
    p.address,
    p.lat && p.lng
      ? <Text variant="bodySm" tone="subdued">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
      : <Badge tone="critical">Fără coord.</Badge>,
  ]);

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
            <div style={{ display: "flex", gap: 16 }}>
              {[
                { label: "FANbox (FAN Courier)", value: fanCount, color: "#e65100" },
                { label: "Easybox (Sameday)",   value: samedayCount, color: "#1565c0" },
                { label: "Total puncte active", value: total, color: "#108043" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  flex: 1, background: "#fff", border: "1px solid #e1e3e5",
                  borderTop: `4px solid ${color}`, borderRadius: 12,
                  padding: "16px 20px",
                }}>
                  <Text variant="headingXl" fontWeight="bold">{value}</Text>
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                </div>
              ))}
            </div>
          </Layout.Section>

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

          {/* ── Filters + Table ──────────────────────────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <Select
                      label="Curier"
                      value={courierFilter}
                      onChange={setCourierFilter}
                      options={[
                        { label: "Toți curierii", value: "" },
                        { label: "FAN Courier (FANbox)", value: "fan" },
                        { label: "Sameday (easybox)",    value: "sameday" },
                      ]}
                    />
                  </div>
                  <div style={{ flex: "2 1 200px" }}>
                    <TextField
                      label="Filtrează după județ"
                      value={countyFilter}
                      onChange={setCountyFilter}
                      placeholder="ex: Cluj, Prahova..."
                      onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                      clearButton
                      onClearButtonClick={() => { setCountyFilter(""); navigate("/app/pickup-points"); }}
                    />
                  </div>
                  <div style={{ paddingTop: 24 }}>
                    <Button onClick={applyFilters} variant="primary">Filtrează</Button>
                  </div>
                </div>

                {points.length === 0 ? (
                  <EmptyState
                    heading="Niciun punct de ridicare"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Configurează credențialele FAN Courier și Sameday în Setări,
                      apoi apasă "Reîmprospătează acum".
                    </p>
                    <Button onClick={() => navigate("/app/settings")}>
                      Mergi la Setări
                    </Button>
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
            </Card>
          </Layout.Section>

        </Layout>
      </Page>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={4000} />}
    </Frame>
  );
}
