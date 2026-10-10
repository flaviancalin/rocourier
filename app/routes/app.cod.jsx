// app/routes/app.cod.jsx
// Cash on delivery: money still with the couriers, late payouts, statement import.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Button, Banner, Select, DropZone,
  DataTable, Badge, Frame, Toast, Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { codOverview, importCodStatement, syncCodFromApis } from "../services/cod.server.js";

const money = (n) => `${(Number(n) || 0).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`;
const COURIERS = [
  { label: "FAN Courier", value: "fan" }, { label: "Sameday", value: "sameday" }, { label: "Cargus", value: "cargus" },
  { label: "GLS", value: "gls" }, { label: "Packeta", value: "packeta" }, { label: "DPD", value: "dpd" },
];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const [overview, settings] = await Promise.all([
    codOverview(session.shop),
    prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { dpdEnabled: true, codSyncedAt: true } }),
  ]);
  return json({ overview, settings });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "sync") {
      const r = await syncCodFromApis(session.shop);
      const d = r.dpd;
      return json({ ok: d ? `DPD: ${d.matched} încasări potrivite cu comenzi, ${d.unmatched} fără comandă` : "Niciun curier cu raport automat (DPD) configurat" });
    }
    if (form.get("intent") === "import") {
      const r = await importCodStatement(session.shop, form.get("courier"), String(form.get("csv") || ""));
      return json({ ok: `${r.rows} rânduri citite: ${r.matched} potrivite cu comenzi, ${r.unmatched} fără comandă în Picklo` });
    }
  } catch (e) {
    return json({ error: e.message });
  }
  return json({ error: "Acțiune necunoscută" }, { status: 400 });
}

export default function Cod() {
  const { overview: o, settings } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [courier, setCourier] = useState("fan");
  const [toast, setToast] = useState(null);
  const busy = nav.state !== "idle";

  useEffect(() => { if (actionData?.ok) setToast(actionData.ok); }, [actionData]);

  const onDrop = async (_all, accepted) => {
    const file = accepted[0];
    if (!file) return;
    const text = await file.text();
    submit({ intent: "import", courier, csv: text }, { method: "post" });
  };

  return (
    <Frame>
      <Page title="Ramburs" subtitle="Banii încasați de curieri și când ajung la tine">
        <Layout>
          {actionData?.error && <Layout.Section><Banner tone="critical" title="Import eșuat">{actionData.error}</Banner></Layout.Section>}

          <Layout.Section>
            <InlineStack gap="400" wrap>
              <Box minWidth="240px"><Card><BlockStack gap="100">
                <Text tone="subdued">La curieri (livrate, neîncasate)</Text>
                <Text variant="heading2xl" as="p">{money(o.awaitingAmount)}</Text>
                <Text tone="subdued">{o.awaitingCount} colete</Text>
              </BlockStack></Card></Box>
              <Box minWidth="240px"><Card><BlockStack gap="100">
                <Text tone="subdued">Întârziate (peste {o.lateAfterDays} zile)</Text>
                <Text variant="heading2xl" as="p" tone={o.late.length ? "critical" : undefined}>{money(o.late.reduce((s, x) => s + x.codAmount, 0))}</Text>
                <Text tone="subdued">{o.late.length} colete</Text>
              </BlockStack></Card></Box>
              <Box minWidth="240px"><Card><BlockStack gap="100">
                <Text tone="subdued">Încasat în ultimele 30 de zile</Text>
                <Text variant="heading2xl" as="p">{money(o.collected30Amount)}</Text>
                <Text tone="subdued">{o.collected30Count} colete</Text>
              </BlockStack></Card></Box>
            </InlineStack>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Actualizează încasările</Text>
                {settings?.dpdEnabled && (
                  <InlineStack gap="300" blockAlign="center">
                    <Button onClick={() => submit({ intent: "sync" }, { method: "post" })} loading={busy}>Preia plățile DPD acum</Button>
                    <Text tone="subdued">DPD se actualizează și automat, zilnic{settings.codSyncedAt ? ` · ultima dată ${new Date(settings.codSyncedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}` : ""}.</Text>
                  </InlineStack>
                )}
                <Text>Pentru FAN, Sameday, Cargus, GLS și Packeta: descarcă borderoul de ramburs din contul curierului, salvează-l ca CSV și încarcă-l aici. Picklo găsește coloanele cu AWB, sumă și dată și marchează comenzile ca încasate (și factura ca plătită, dacă ai facturare activă).</Text>
                <Box maxWidth="260px"><Select label="Curier" value={courier} onChange={setCourier} options={COURIERS} /></Box>
                <DropZone accept=".csv,text/csv,text/plain" type="file" allowMultiple={false} onDrop={onDrop} disabled={busy}>
                  <DropZone.FileUpload actionTitle="Încarcă borderoul CSV" actionHint="sau trage fișierul aici" />
                </DropZone>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Rambursuri întârziate</Text>
                {o.late.length === 0 ? <Text tone="subdued">Nicio plată întârziată.</Text> : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text"]}
                    headings={["Comandă", "Curier", "AWB", "Sumă", "Livrat"]}
                    rows={o.late.map((x) => [x.shopifyOrderName, x.courierType.toUpperCase(), x.awbNumber, money(x.codAmount),
                      new Date(x.deliveredAt || x.updatedAt).toLocaleDateString("ro-RO")])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd">Ultimele plăți primite</Text>
                  {o.unmatched > 0 && <Badge tone="warning">{o.unmatched} fără comandă în Picklo</Badge>}
                </InlineStack>
                {o.recentPayouts.length === 0 ? <Text tone="subdued">Nicio plată importată încă.</Text> : (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text", "text"]}
                    headings={["Data", "Curier", "Sumă", "AWB", "Comandă"]}
                    rows={o.recentPayouts.map((p) => [p.paidAt ? new Date(p.paidAt).toLocaleDateString("ro-RO") : "—", p.courier.toUpperCase(), money(p.amount), p.awbNumber, p.orderId ? "✓" : "—"])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
        {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
