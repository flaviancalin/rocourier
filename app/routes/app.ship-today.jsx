// app/routes/app.ship-today.jsx
// "To ship today": orders waiting for an AWB and parcels waiting for the courier,
// with bulk AWB, labels, packing slips, mark as shipped and courier pickup (DPD).
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useRevalidator, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, Checkbox, Banner, Box, ProgressBar, Frame, Toast, Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { warningsForOrders } from "../services/order-checks.server.js";
import { dpdRequestPickup } from "../services/dpd.server.js";
import { logActivity } from "../services/activity.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";
import { estimateDelivery, romaniaNow } from "../utils/delivery-estimate.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const since = new Date(Date.now() - 14 * 864e5);
  const [toLabel, toHandOver, settings] = await Promise.all([
    prisma.order.findMany({
      where: { shop, awbNumber: null, shopifyCancelledAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" }, take: 200,
    }),
    prisma.order.findMany({
      where: { shop, awbStatus: "generated", awbNumber: { not: null } },
      orderBy: { updatedAt: "asc" }, take: 200,
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);
  const warnings = await warningsForOrders(shop, toLabel, settings);
  const { hour } = romaniaNow();
  const cutoff = settings?.dispatchCutoffHour ?? 14;
  return json({
    toLabel, toHandOver, warnings,
    cutoff, beforeCutoff: hour < cutoff,
    shipDate: estimateDelivery({ cutoffHour: cutoff, processingDays: settings?.processingDays ?? 0 }).shipDate,
    dpdEnabled: !!settings?.dpdEnabled,
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "dpd-pickup") return json({ error: "Acțiune necunoscută" }, { status: 400 });
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  const orders = await prisma.order.findMany({ where: { shop: session.shop, courierType: "dpd", awbStatus: "generated", awbNumber: { not: null } } });
  if (!orders.length) return json({ error: "Niciun colet DPD care așteaptă curierul." });
  try {
    const r = await dpdRequestPickup({
      username: settings.dpdUsername, password: settings.dpdPassword, awbNumbers: orders.map((o) => o.awbNumber),
      visitEndTime: `${String(Math.min(20, (settings.dispatchCutoffHour ?? 14) + 3)).padStart(2, "0")}:00`,
      contactName: settings.senderName, phone: settings.senderPhone,
    });
    await logActivity({ shop: session.shop, action: "pickup_requested", actor: session.onlineAccessInfo?.associated_user?.email || "staff",
      message: `Ridicare DPD comandată pentru ${orders.length} colete${r[0]?.pickupPeriodFrom ? ` (${r[0].pickupPeriodFrom}–${r[0].pickupPeriodTo})` : ""}` });
    return json({ ok: `Curierul DPD a fost chemat pentru ${orders.length} colete.` });
  } catch (e) {
    return json({ error: e.message });
  }
}

export default function ShipToday() {
  const { toLabel, toHandOver, warnings, cutoff, beforeCutoff, shipDate, dpdEnabled } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState(() => toLabel.filter((o) => !warnings[o.id]).map((o) => o.id));
  const [run, setRun] = useState(null); // { done, total, errors: [] }
  const [toast, setToast] = useState(null);

  useEffect(() => { if (actionData?.ok) setToast(actionData.ok); }, [actionData]);

  const byCourier = useMemo(() => {
    const m = {};
    for (const o of toHandOver) m[o.courierType] = (m[o.courierType] || 0) + 1;
    return m;
  }, [toHandOver]);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function generateSelected() {
    const ids = [...selected];
    setRun({ done: 0, total: ids.length, errors: [] });
    const errors = [];
    for (let i = 0; i < ids.length; i++) {
      const o = toLabel.find((x) => x.id === ids[i]);
      try {
        const res = await fetch("/api/generate-awb", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: ids[i], recipientPhone: o.customerPhone || undefined, useRules: true }),
        });
        const data = await res.json();
        if (!res.ok || data.error) errors.push(`${o.shopifyOrderName}: ${data.error || res.status}`);
      } catch (e) {
        errors.push(`${o.shopifyOrderName}: ${e.message}`);
      }
      setRun({ done: i + 1, total: ids.length, errors: [...errors] });
    }
    setSelected([]);
    revalidator.revalidate();
  }

  const handOverIds = toHandOver.map((o) => o.id).join(",");
  const shipLabel = new Date(shipDate).toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long" });

  async function markShipped() {
    const res = await fetch("/api/bulk-fulfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: toHandOver.map((o) => o.id) }) });
    const data = await res.json().catch(() => ({}));
    setToast(res.ok ? `${data.succeeded ?? toHandOver.length} comenzi marcate ca expediate în Shopify` : data.error || "Eroare");
  }

  return (
    <Frame>
      <Page title="De expediat azi" subtitle={beforeCutoff ? `Ora limită de azi: ${cutoff}:00 — ce pleacă până atunci ajunge mâine` : `Ora limită (${cutoff}:00) a trecut — coletele pleacă ${shipLabel}`}>
        <Layout>
          {actionData?.error && <Layout.Section><Banner tone="critical">{actionData.error}</Banner></Layout.Section>}

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd">1. Comenzi fără AWB ({toLabel.length})</Text>
                  <InlineStack gap="200">
                    <Button onClick={() => setSelected(toLabel.map((o) => o.id))}>Selectează tot</Button>
                    <Button variant="primary" disabled={!selected.length || (run && run.done < run.total)} onClick={generateSelected}>
                      Generează {selected.length} AWB-uri
                    </Button>
                  </InlineStack>
                </InlineStack>
                {run && (
                  <BlockStack gap="100">
                    <ProgressBar progress={(run.done / Math.max(1, run.total)) * 100} size="small" />
                    <Text tone="subdued">{run.done} / {run.total} procesate{run.errors.length ? ` · ${run.errors.length} erori` : ""}</Text>
                    {run.errors.length > 0 && <Banner tone="warning" title="Nu s-au generat">{run.errors.map((e) => <div key={e}>{e}</div>)}</Banner>}
                  </BlockStack>
                )}
                {toLabel.length === 0 ? <Text tone="subdued">Toate comenzile au AWB. 🎉</Text> : (
                  <BlockStack gap="150">
                    {toLabel.map((o) => (
                      <InlineStack key={o.id} gap="300" blockAlign="center" wrap={false}>
                        <Checkbox label="" labelHidden checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                        <Box minWidth="80px"><Text fontWeight="semibold">{o.shopifyOrderName}</Text></Box>
                        <Box minWidth="0"><Text truncate>{o.customerName} · {o.shippingCity}</Text></Box>
                        <Badge>{COURIER_LABELS[o.courierType]?.name || o.courierType}{o.shippingMethod === "pickup_point" ? " · locker" : ""}</Badge>
                        {o.codAmount > 0 && <Badge tone="attention">{`Ramburs ${o.codAmount.toFixed(0)} RON`}</Badge>}
                        {warnings[o.id] && <span title={warnings[o.id].map((w) => w.message).join("\n")}><Badge tone="warning">{`⚠ ${warnings[o.id].length}`}</Badge></span>}
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
                <Text tone="subdued" variant="bodySm">Comenzile cu ⚠ nu sunt selectate implicit: verifică-le întâi (adresă, telefon, locker, refuzuri anterioare).</Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">2. Pregătește coletele ({toHandOver.length})</Text>
                <InlineStack gap="200" wrap>
                  {Object.entries(byCourier).map(([c, n]) => <Badge key={c}>{`${COURIER_LABELS[c]?.name || c}: ${n}`}</Badge>)}
                </InlineStack>
                <InlineStack gap="200" wrap>
                  <Button disabled={!toHandOver.length} url={`/api/bulk-print-awb?orderIds=${handOverIds}`} target="_blank">Printează toate etichetele</Button>
                  <Button disabled={!toHandOver.length} url={`/api/packing-slip?orderIds=${handOverIds}`} target="_blank">Printează packing slips</Button>
                  <Button disabled={!toHandOver.length} onClick={markShipped}>Marchează expediate în Shopify</Button>
                </InlineStack>
                <Divider />
                <Text variant="headingMd">3. Predă curierului</Text>
                {dpdEnabled && (
                  <InlineStack gap="300" blockAlign="center">
                    <Button disabled={!byCourier.dpd} loading={nav.state !== "idle"} onClick={() => submit({ intent: "dpd-pickup" }, { method: "post" })}>
                      Cheamă curierul DPD ({byCourier.dpd || 0} colete)
                    </Button>
                  </InlineStack>
                )}
                <Text tone="subdued">FAN, Sameday, Cargus și GLS ridică de obicei zilnic, pe baza AWB-urilor generate. Statusul trece automat în „Preluat de curier” când scanează coletul.</Text>
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
