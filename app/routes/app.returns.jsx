// app/routes/app.returns.jsx
// Return requests filed by customers: approve and create the return AWB, reject,
// mark as received / refunded, print the return label.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useSubmit, useNavigation, useActionData, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, Tabs, Banner, Box,
  EmptyState, TextField, Divider, Frame, Toast,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { generateReturnAwb, setReturnStatus } from "../services/returns.server.js";
import { RETURN_COURIERS } from "../utils/returns.js";
import { mailConfigured } from "../services/mail.server.js";
import { withdrawalRef } from "../utils/withdrawal.js";

const STATUS = {
  requested:     { label: "Cerere nouă",   tone: "attention" },
  approved:      { label: "Aprobată",      tone: "info" },
  awb_generated: { label: "AWB retur creat", tone: "info" },
  received:      { label: "Primit înapoi", tone: "success" },
  refunded:      { label: "Rambursat",     tone: "success" },
  rejected:      { label: "Respinsă",      tone: "critical" },
};
const TABS = [
  { id: "open", content: "De rezolvat", statuses: ["requested", "approved", "awb_generated"] },
  { id: "done", content: "Încheiate", statuses: ["received", "refunded", "rejected"] },
];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = TABS.find((t) => t.id === url.searchParams.get("tab")) || TABS[0];
  const [returns, settings, counts] = await Promise.all([
    prisma.returnRequest.findMany({ where: { shop: session.shop, status: { in: tab.statuses } }, orderBy: { createdAt: "desc" }, take: 100, omit: { returnLabelRef: true } }),
    prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { returnsEnabled: true, returnsCourier: true, withdrawalEnabled: true, senderEmail: true } }),
    prisma.returnRequest.count({ where: { shop: session.shop, status: "requested" } }),
  ]);
  const orders = await prisma.order.findMany({
    where: { id: { in: returns.map((r) => r.orderId) } },
    select: { id: true, courierType: true, shippingAddress1: true, shippingCity: true, codAmount: true, orderTotal: true },
  });
  return json({ returns, settings, newCount: counts, orders: Object.fromEntries(orders.map((o) => [o.id, o])), shop: session.shop, tab: tab.id, mailReady: mailConfigured() });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = form.get("id");
  const actor = session.onlineAccessInfo?.associated_user?.email || "staff";
  if (form.get("intent") === "withdrawal-toggle") {
    const on = form.get("value") === "true";
    await prisma.shopSettings.update({ where: { shop: session.shop }, data: { withdrawalEnabled: on } });
    return json({ ok: on ? "Butonul de retragere e pornit" : "Butonul de retragere e oprit" });
  }
  const owned = await prisma.returnRequest.findFirst({ where: { id, shop: session.shop } });
  if (!owned) return json({ error: "Cererea nu există" }, { status: 404 });
  try {
    switch (form.get("intent")) {
      case "approve": {
        await setReturnStatus(session.shop, id, "approved", { actor });
        const awb = await generateReturnAwb(session.shop, id, { actor });
        return json({ ok: `AWB retur ${awb.awbNumber} creat la ${awb.courier.toUpperCase()}` });
      }
      case "awb": {
        const awb = await generateReturnAwb(session.shop, id, { actor });
        return json({ ok: `AWB retur ${awb.awbNumber} creat` });
      }
      case "reject":
        await setReturnStatus(session.shop, id, "rejected", { note: form.get("note") || null, actor });
        return json({ ok: "Cererea a fost respinsă" });
      case "received":
        await setReturnStatus(session.shop, id, "received", { actor });
        return json({ ok: "Marcat ca primit" });
      case "refunded":
        await setReturnStatus(session.shop, id, "refunded", { actor });
        return json({ ok: "Marcat ca rambursat" });
      default:
        return json({ error: "Acțiune necunoscută" }, { status: 400 });
    }
  } catch (e) {
    return json({ error: e.message });
  }
}

function WithdrawalCard({ settings, shop, mailReady, onToggle, busy }) {
  const url = `https://${shop}/apps/rocourier/withdraw`;
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingMd">Retragere din contract</Text>
            <Badge tone={settings?.withdrawalEnabled ? "success" : undefined}>{settings?.withdrawalEnabled ? "Pornit" : "Oprit"}</Badge>
          </InlineStack>
          <Button variant={settings?.withdrawalEnabled ? "secondary" : "primary"} loading={busy} onClick={() => onToggle(!settings?.withdrawalEnabled)}>
            {settings?.withdrawalEnabled ? "Oprește" : "Pornește butonul de retragere"}
          </Button>
        </InlineStack>
        <Text tone="subdued">Obligatoriu pentru vânzările online către clienți din UE (Directiva 2023/2673; în România OUG 18/2026). Clientul renunță la comandă în 14 zile de la primire, fără motiv, în doi pași (alege produsele, apoi confirmă), și primește confirmarea. Cererile apar aici, marcate „Retragere”, cu termenul de rambursare de 14 zile.</Text>
        {settings?.withdrawalEnabled && (
          <BlockStack gap="200">
            <Text fontWeight="semibold">Unde apare butonul</Text>
            <Text>1. <strong>În contul clientului</strong>, la fiecare comandă: „Retragere din contract”. Apare singur după instalarea versiunii noi a aplicației.</Text>
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text>2. <strong>Pe site</strong>: adaugă linkul în meniul din subsol (Online Store → Navigation → Footer → Add menu item):</Text>
              <Text as="span" fontWeight="semibold">{url}</Text>
              <Button size="slim" onClick={copy}>{copied ? "Copiat" : "Copiază linkul"}</Button>
              <Button size="slim" url={`https://${shop}/admin/menus`} target="_top">Deschide meniurile</Button>
            </InlineStack>
            <Text tone="subdued">Numește linkul „Retragere din contract” (textul cerut de lege trebuie să fie clar).</Text>
            {!mailReady && (
              <Banner tone="info">Confirmarea apare acum pe ecran și se salvează pe comanda din Shopify (eticheta „retragere-contract”) și în Picklo. Trimiterea automată pe email se activează după configurarea serviciului de email Picklo.</Banner>
            )}
            {mailReady && !settings?.senderEmail && (
              <Banner tone="warning">Completează emailul expeditorului în Setări → Expeditor ca să primești și tu notificarea pentru fiecare retragere.</Banner>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Returns() {
  const { returns, settings, newCount, orders, shop, tab, mailReady } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [params, setParams] = useSearchParams();
  const [toast, setToast] = useState(null);
  const [rejectNote, setRejectNote] = useState({});
  const busy = (id) => nav.state !== "idle" && nav.formData?.get("id") === id;

  useEffect(() => {
    if (actionData?.ok) setToast(actionData.ok);
  }, [actionData]);

  const act = (intent, id, extra = {}) => submit({ intent, id, ...extra }, { method: "post" });
  const selectedTab = Math.max(0, TABS.findIndex((t) => t.id === tab));

  return (
    <Frame>
      <Page title="Retururi" subtitle={newCount ? `${newCount} cereri noi` : undefined}>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {!settings?.returnsEnabled && (
                <Banner tone="warning" title="Formularul de retur e oprit"
                  action={{ content: "Activează din Setări", url: "/app/settings" }}>
                  <Text>Activează retururile din Setări → Livrare &amp; verificări. Clienții vor putea cere returul de la https://{shop}/apps/rocourier/returns.</Text>
                </Banner>
              )}
              {actionData?.error && <Banner tone="critical" title="Nu s-a putut finaliza">{actionData.error}</Banner>}
              <WithdrawalCard settings={settings} shop={shop} mailReady={mailReady}
                busy={nav.state !== "idle" && nav.formData?.get("intent") === "withdrawal-toggle"}
                onToggle={(v) => submit({ intent: "withdrawal-toggle", value: String(v) }, { method: "post" })} />

              <Card padding="0">
                <Tabs tabs={TABS} selected={selectedTab} onSelect={(i) => { params.set("tab", TABS[i].id); setParams(params); }} />
                <Box padding="400">
                  {returns.length === 0 ? (
                    <EmptyState heading={tab === "open" ? "Nicio cerere de retur deschisă" : "Nimic aici încă"} image="">
                      <Text>Cererile trimise de clienți din formularul de retur apar aici.</Text>
                    </EmptyState>
                  ) : (
                    <BlockStack gap="400">
                      {returns.map((r) => {
                        const st = STATUS[r.status] || { label: r.status };
                        const order = orders[r.orderId];
                        const courier = settings?.returnsCourier || order?.courierType;
                        return (
                          <Card key={r.id}>
                            <BlockStack gap="300">
                              <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="200" blockAlign="center">
                                  <Text variant="headingMd">{r.shopifyOrderName}</Text>
                                  <Badge tone={st.tone}>{st.label}</Badge>
                                  {r.kind === "withdrawal" && <Badge tone="warning">{`Retragere ${withdrawalRef(r.id)}`}</Badge>}
                                  {r.kind === "withdrawal" && r.refundDueAt && !["refunded", "rejected"].includes(r.status) && (
                                    <Badge tone={new Date(r.refundDueAt) - Date.now() < 3 * 864e5 ? "critical" : "info"}>
                                      {`Rambursare până la ${new Date(r.refundDueAt).toLocaleDateString("ro-RO")}`}
                                    </Badge>
                                  )}
                                </InlineStack>
                                <Text tone="subdued">{new Date(r.createdAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}</Text>
                              </InlineStack>
                              <Text>{r.customerName} · {r.customerPhone} · {r.customerEmail}</Text>
                              <Text tone="subdued">Ridicare de la: {order?.shippingAddress1}, {order?.shippingCity}</Text>
                              <Divider />
                              <BlockStack gap="100">
                                {(r.items || []).map((it, i) => <Text key={i}>• {it.quantity} × {it.name}{it.sku ? ` (${it.sku})` : ""}</Text>)}
                              </BlockStack>
                              <Text><strong>Motiv:</strong> {r.reason}{r.comment ? ` — ${r.comment}` : ""}</Text>
                              {r.iban && <Text><strong>IBAN rambursare:</strong> {r.iban}</Text>}
                              {r.returnAwbNumber && (
                                <InlineStack gap="200" blockAlign="center">
                                  <Text><strong>AWB retur:</strong> {r.returnAwbNumber} ({r.returnCourier?.toUpperCase()})</Text>
                                  {r.returnCourier !== "packeta" && <Button url={`/api/print-awb?returnId=${r.id}`} target="_blank">Printează eticheta</Button>}
                                </InlineStack>
                              )}
                              {r.dropoffPassword && (
                                <Banner tone="info">Retur Packeta: clientul duce coletul la orice punct Packeta sau Z-BOX și spune parola <strong>{r.dropoffPassword}</strong>. Packeta i-a trimis-o și pe email.</Banner>
                              )}
                              {r.merchantNote && <Text tone="subdued">Notă: {r.merchantNote}</Text>}

                              <InlineStack gap="200" wrap>
                                {r.status === "requested" && (
                                  <>
                                    <Button variant="primary" loading={busy(r.id)} disabled={!RETURN_COURIERS.includes(courier)}
                                      onClick={() => act("approve", r.id)}>
                                      Aprobă și creează AWB retur ({(courier || "").toUpperCase()})
                                    </Button>
                                    <Box minWidth="220px">
                                      <TextField labelHidden label="Motiv respingere" placeholder="Motiv respingere (opțional)" autoComplete="off"
                                        value={rejectNote[r.id] || ""} onChange={(v) => setRejectNote({ ...rejectNote, [r.id]: v })} />
                                    </Box>
                                    <Button tone="critical" loading={busy(r.id)} onClick={() => act("reject", r.id, { note: rejectNote[r.id] || "" })}>Respinge</Button>
                                  </>
                                )}
                                {r.status === "approved" && !r.returnAwbNumber && (
                                  <Button variant="primary" loading={busy(r.id)} onClick={() => act("awb", r.id)}>Creează AWB retur</Button>
                                )}
                                {["approved", "awb_generated"].includes(r.status) && (
                                  <Button loading={busy(r.id)} onClick={() => act("received", r.id)}>Am primit coletul</Button>
                                )}
                                {r.status === "received" && (
                                  <Button loading={busy(r.id)} onClick={() => act("refunded", r.id)}>Marchează rambursat</Button>
                                )}
                                <Button variant="plain" url={`/app/order-detail/${r.orderId}`}>Vezi comanda</Button>
                              </InlineStack>
                              {r.status === "requested" && !RETURN_COURIERS.includes(courier) && (
                                <Text tone="critical">Returul prin {courier} nu e suportat automat — alege un curier pentru retururi în Setări.</Text>
                              )}
                            </BlockStack>
                          </Card>
                        );
                      })}
                    </BlockStack>
                  )}
                </Box>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
