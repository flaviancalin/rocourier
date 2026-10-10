// app/routes/app.reports.jsx
// Delivery performance per courier + the store's activity log.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, DataTable, Select, Box, Divider, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { deliveryReport } from "../services/analytics.server.js";
import { listActivity } from "../services/activity.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const days = [7, 30, 90, 365].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  const [report, activity] = await Promise.all([deliveryReport(session.shop, days), listActivity(session.shop, { take: 100 })]);
  return json({ report, activity });
}

const pct = (v) => (v == null ? "—" : `${v}%`);

export default function Reports() {
  const { report: r, activity } = useLoaderData();
  const [params, setParams] = useSearchParams();

  return (
    <Page title="Rapoarte" subtitle="Cum livrează fiecare curier și ce s-a întâmplat în magazin">
      <Layout>
        <Layout.Section>
          <InlineStack align="space-between" blockAlign="end">
            <InlineStack gap="400" wrap>
              <Box minWidth="180px"><Card><BlockStack gap="050"><Text tone="subdued">AWB-uri</Text><Text variant="heading2xl" as="p">{r.total}</Text></BlockStack></Card></Box>
              <Box minWidth="180px"><Card><BlockStack gap="050"><Text tone="subdued">La locker / punct</Text><Text variant="heading2xl" as="p">{r.pickupShare}%</Text></BlockStack></Card></Box>
              <Box minWidth="180px"><Card><BlockStack gap="050"><Text tone="subdued">Cu ramburs</Text><Text variant="heading2xl" as="p">{r.codShare}%</Text></BlockStack></Card></Box>
            </InlineStack>
            <Box minWidth="180px">
              <Select label="Perioada" value={String(r.days)} onChange={(v) => { params.set("days", v); setParams(params); }}
                options={[{ label: "Ultimele 7 zile", value: "7" }, { label: "Ultimele 30 de zile", value: "30" }, { label: "Ultimele 90 de zile", value: "90" }, { label: "Ultimul an", value: "365" }]} />
            </Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Performanță pe curieri</Text>
              {r.couriers.length === 0 ? <Text tone="subdued">Niciun AWB în perioada aleasă.</Text> : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Curier", "AWB-uri", "Livrate", "Refuzate / returnate", "Zile până la livrare", "Cost mediu", "Cost / vânzări"]}
                  rows={r.couriers.map((c) => [
                    COURIER_LABELS[c.courier]?.name || c.courier, c.shipped, pct(c.deliveryRate), pct(c.returnRate),
                    c.avgDays ?? "—", c.avgCost != null ? `${c.avgCost.toFixed(2)} RON` : "—", pct(c.costShare),
                  ])}
                />
              )}
              <Text tone="subdued" variant="bodySm">Procentele se calculează din coletele încheiate (livrate, returnate sau eșuate). Costul apare pentru curierii care îl trimit la generarea AWB-ului (de exemplu DPD).</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {r.topLockers.length > 0 && (
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd">Cele mai folosite lockere</Text>
                <Divider />
                {r.topLockers.map((l) => (
                  <InlineStack key={l.name} align="space-between" wrap={false}><Text truncate>{l.name}</Text><Badge>{String(l.count)}</Badge></InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd">Jurnal de activitate</Text>
              <Divider />
              {activity.length === 0 ? <Text tone="subdued">Nicio acțiune înregistrată încă.</Text> : activity.map((a) => (
                <InlineStack key={a.id} gap="300" wrap={false} blockAlign="start">
                  <Box minWidth="130px"><Text tone="subdued" variant="bodySm">{new Date(a.createdAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Text></Box>
                  <Box minWidth="70px"><Text variant="bodySm" fontWeight="semibold">{a.orderName || "—"}</Text></Box>
                  <Text variant="bodySm">{a.message}{a.actor ? <Text as="span" tone="subdued"> · {a.actor === "automation" ? "automat" : a.actor}</Text> : null}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
