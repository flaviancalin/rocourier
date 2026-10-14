// app/routes/app.reports.jsx
// Delivery performance per courier + the store's activity log.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useSearchParams, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, DataTable, Select, Box, Divider, Badge, Button, TextField, Banner } from "@shopify/polaris";
import { prisma } from "../db.server.js";
import { profitReport } from "../services/profit.server.js";
import { monthRange } from "../services/accounting-export.server.js";
import { authenticate } from "../shopify.server.js";
import { deliveryReport } from "../services/analytics.server.js";
import { listActivity } from "../services/activity.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = [7, 30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const month = monthRange(url.searchParams.get("month"));
  const [report, activity, profit, settings] = await Promise.all([
    deliveryReport(session.shop, days), listActivity(session.shop, { take: 100 }),
    profitReport(admin, session.shop, month).catch((e) => ({ error: e.message })),
    prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { paymentFeePercent: true, sagaCodAccount: true, smartbillCompanyCIF: true, oblioCIF: true, fgoCui: true } }),
  ]);
  return json({ report, activity, profit, month: month.label, settings });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const fee = Math.min(10, Math.max(0, Number.parseFloat(String(form.get("paymentFeePercent") || "0").replace(",", ".")) || 0));
  const account = String(form.get("sagaCodAccount") || "5311").replace(/[^0-9.]/g, "").slice(0, 10) || "5311";
  await prisma.shopSettings.update({ where: { shop: session.shop }, data: { paymentFeePercent: fee, sagaCodAccount: account } });
  return json({ ok: "Salvat" });
}

const money = (n) => (n == null ? "—" : `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`);

// Downloads go through fetch so the request carries the session token, then saved as a file
async function download(type, month) {
  const res = await fetch(`/api/export?type=${type}&month=${month}`);
  if (!res.ok) throw new Error(await res.text());
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `${type}-${month}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function lastMonths(n = 13) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: m.toLocaleDateString("ro-RO", { month: "long", year: "numeric" }) });
  }
  return out;
}

function ProfitAndExport({ profit: pr, month, settings }) {
  const [params, setParams] = useSearchParams();
  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData();
  const [fee, setFee] = useState(String(settings?.paymentFeePercent ?? 0));
  const [account, setAccount] = useState(settings?.sagaCodAccount || "5311");
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const cif = settings?.smartbillCompanyCIF || settings?.oblioCIF || settings?.fgoCui;
  const get = async (type) => { setBusy(type); setErr(null); try { await download(type, month); } catch (e) { setErr(e.message); } finally { setBusy(null); } };
  useEffect(() => { if (actionData?.ok) setErr(null); }, [actionData]);

  return (
    <>
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="end" wrap>
              <Text variant="headingMd">Profit pe lună</Text>
              <Box minWidth="200px"><Select label="Luna" labelHidden value={month} options={lastMonths()} onChange={(v) => { params.set("month", v); setParams(params); }} /></Box>
            </InlineStack>
            {pr?.error ? <Banner tone="critical">{pr.error}</Banner> : (
              <>
                <InlineStack gap="400" wrap>
                  <Box minWidth="150px"><BlockStack gap="050"><Text tone="subdued">Vânzări fără TVA</Text><Text variant="headingLg" as="p">{money(pr.revenue)}</Text></BlockStack></Box>
                  <Box minWidth="150px"><BlockStack gap="050"><Text tone="subdued">Cost produse</Text><Text variant="headingLg" as="p">{money(pr.cogs)}</Text></BlockStack></Box>
                  <Box minWidth="150px"><BlockStack gap="050"><Text tone="subdued">Transport și retururi</Text><Text variant="headingLg" as="p">{money(pr.shipping)}</Text></BlockStack></Box>
                  <Box minWidth="150px"><BlockStack gap="050"><Text tone="subdued">Comisioane plată</Text><Text variant="headingLg" as="p">{money(pr.paymentFee)}</Text></BlockStack></Box>
                  <Box minWidth="150px"><BlockStack gap="050"><Text tone="subdued">Profit</Text><Text variant="headingLg" as="p" tone={pr.profit < 0 ? "critical" : "success"}>{money(pr.profit)}{pr.margin != null ? ` · ${pr.margin}%` : ""}</Text></BlockStack></Box>
                </InlineStack>
                <Text tone="subdued" variant="bodySm">{pr.count} comenzi. Costul produselor vine din Shopify (Produse → costul pe bucată). Transportul e costul real primit de la curier la generarea AWB-ului{pr.vatRate > 0 ? `, fără TVA (${pr.vatRate}%)` : ""}.</Text>
                {pr.missingCosts > 0 && <Banner tone="warning">{`${pr.missingCosts} comenzi au produse fără cost setat în Shopify, deci profitul lor e mai mare decât în realitate. Completează „Cost pe bucată” la produse.`}</Banner>}
                {pr.syncError && <Banner tone="warning">{`Nu am putut citi costurile din Shopify: ${pr.syncError}. Aprobă permisiunile noi ale aplicației (produse și stoc).`}</Banner>}
                {pr.losing?.length > 0 && (
                  <BlockStack gap="100">
                    <Text fontWeight="semibold">Comenzi pe pierdere</Text>
                    {pr.losing.slice(0, 10).map((l) => (
                      <InlineStack key={l.id} gap="200"><Button variant="plain" url={`/app/order-detail/${l.id}`}>{l.name}</Button><Text tone="critical">{money(l.profit)}</Text><Text tone="subdued">{l.reason}</Text></InlineStack>
                    ))}
                  </BlockStack>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">Export contabil</Text>
            <Text tone="subdued">Fișierele pentru contabil, pentru luna aleasă mai sus. Facturile rămân în programul de facturare; aici sunt încasările din ramburs, costurile de transport și jurnalul de vânzări.</Text>
            {err && <Banner tone="critical">{err}</Banner>}
            <InlineStack gap="200" wrap>
              <Button loading={busy === "sales"} onClick={() => get("sales")}>Jurnal vânzări (CSV)</Button>
              <Button loading={busy === "cod"} onClick={() => get("cod")}>Ramburs pe AWB (CSV)</Button>
              <Button loading={busy === "shipping"} onClick={() => get("shipping")}>Costuri transport (CSV)</Button>
            </InlineStack>
            <Divider />
            <Text fontWeight="semibold">SAGA</Text>
            <Text tone="subdued">În Saga C: Diverse → Import date → Import date din fișiere. Încasările se leagă de facturi după numărul facturii.</Text>
            <InlineStack gap="200" wrap>
              <Button loading={busy === "saga-receipts"} onClick={() => get("saga-receipts")}>Încasări ramburs (XML SAGA)</Button>
              <Button loading={busy === "saga-invoices"} disabled={!cif} onClick={() => get("saga-invoices")}>Facturi ieșiri (XML SAGA)</Button>
            </InlineStack>
            {!cif && <Text tone="subdued" variant="bodySm">Pentru facturile SAGA completează CUI-ul firmei în Setări → Facturare.</Text>}
            <Text tone="subdued" variant="bodySm">Facturile SAGA sunt pentru magazinele al căror program de facturare nu exportă direct în SAGA (SmartBill o face). Nu le importa de două ori.</Text>
            <InlineStack gap="300" wrap blockAlign="end">
              <Box minWidth="200px"><TextField label="Comision plăți cu cardul (%)" value={fee} onChange={setFee} type="number" min="0" max="10" step="0.1" autoComplete="off" helpText="Pentru profit. Rambursul are taxa inclusă în costul curierului." /></Box>
              <Box minWidth="200px"><TextField label="Cont SAGA pentru ramburs" value={account} onChange={setAccount} autoComplete="off" helpText="5311 casa sau contul pe care îl folosește contabilul" /></Box>
              <Button loading={nav.state !== "idle"} onClick={() => submit({ paymentFeePercent: fee, sagaCodAccount: account }, { method: "post" })}>Salvează</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>
    </>
  );
}

const pct = (v) => (v == null ? "—" : `${v}%`);

export default function Reports() {
  const { report: r, activity, profit, month, settings } = useLoaderData();
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

        <ProfitAndExport profit={profit} month={month} settings={settings} />

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
