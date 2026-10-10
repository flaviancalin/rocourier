// app/routes/hq.shops.$shop.jsx — one store: health, support actions, settings, orders, history
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, Banner, Box, Divider, Checkbox, TextField, Select, DataTable, Tabs, Toast,
} from "@shopify/polaris";
import { requireTeam } from "../services/hq-auth.server.js";
import { shopOverview, runAction, ACTIONS, EDITABLE } from "../services/hq-actions.server.js";
import { STATUSES } from "../utils/support.js";

export async function loader({ request, params }) {
  await requireTeam(request);
  const overview = await shopOverview(params.shop);
  if (!overview) throw new Response("Magazinul nu există în Picklo", { status: 404 });
  return json({ overview, editable: EDITABLE, actions: ACTIONS, appHandle: "rocourier" });
}

export async function action({ request, params }) {
  const member = await requireTeam(request);
  const form = await request.formData();
  try {
    const r = await runAction(params.shop, String(form.get("intent")), member, form);
    return json({ ok: true, intent: form.get("intent"), ...r });
  } catch (e) {
    return json({ ok: false, intent: form.get("intent"), error: friendlyError(e) });
  }
}

// Shopify client errors carry a JSON dump; keep the part a support person can act on
function friendlyError(e) {
  const msg = e?.message || (e?.status ? `Shopify a răspuns ${e.status}` : String(e));
  const code = Number(/networkStatusCode"?:\s*(\d+)/.exec(msg)?.[1] || e?.status || 0);
  if (code === 401 || code === 403) return "Shopify a refuzat accesul: tokenul magazinului nu mai e valid sau lipsesc permisiuni. Clientul trebuie să deschidă Picklo o dată (reautorizare).";
  if (code === 404) return "Shopify nu găsește magazinul: aplicația a fost dezinstalată sau magazinul e închis.";
  if (code === 429) return "Shopify limitează cererile acum — încearcă din nou peste un minut.";
  return msg.split("\n")[0].slice(0, 300);
}

const fmt = (d) => new Date(d).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const LABELS = {
  autoGenerateAwb: "AWB automat la comandă nouă", autoSendInvoice: "Factură automată la comandă nouă", autoInvoiceOnFulfill: "Factură la expediere",
  autoInvoiceOnDelivered: "Factură la livrare", onboardingCompleted: "Ghid de configurare terminat", validateAddresses: "Verifică adresele",
  returnsEnabled: "Retururi active", showDeliveryEstimate: "Arată data estimată", showPickupMap: "Hartă lockere",
};

export default function ShopDetail() {
  const { overview: o, editable, actions, appHandle } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState(null);
  const [themes, setThemes] = useState(null);
  const s = o.settings;
  const busyIntent = nav.state !== "idle" ? nav.formData?.get("intent") : null;

  const [form, setForm] = useState(() => Object.fromEntries([...editable.booleans, ...editable.numbers, ...editable.strings].map((k) => [k, s[k] ?? (editable.booleans.includes(k) ? false : "")])));
  useEffect(() => {
    if (!actionData) return;
    if (actionData.themes) setThemes(actionData.themes);
    setToast(actionData.ok ? (actionData.message || "Gata") : `Eroare: ${actionData.error}`);
  }, [actionData]);

  const run = (intent, extra = {}) => submit({ intent, ...extra }, { method: "post" });
  const handle = o.shop.replace(".myshopify.com", "");
  const dirty = useMemo(() => Object.keys(form).filter((k) => String(form[k] ?? "") !== String(s[k] ?? (editable.booleans.includes(k) ? false : ""))), [form, s, editable]);

  const copy = async (text) => { try { await navigator.clipboard.writeText(text); setToast("Link copiat"); } catch { setToast(text); } };

  const tabs = [{ id: "overview", content: "Privire generală" }, { id: "settings", content: "Setări" }, { id: "orders", content: "Comenzi" }, { id: "activity", content: "Istoric" }];

  return (
    <Page
      backAction={{ url: "/hq/shops" }}
      title={handle}
      subtitle={o.shop}
      titleMetadata={<InlineStack gap="100">{o.installed ? <Badge tone="success">instalat</Badge> : <Badge>dezinstalat</Badge>}<Badge>{s.planType}</Badge></InlineStack>}
      secondaryActions={[
        { content: "Picklo în adminul magazinului", url: `https://admin.shopify.com/store/${handle}/apps/${appHandle}`, external: true },
        { content: "Cere acces colaborator", url: "https://partners.shopify.com/", external: true, helpText: "Partner Dashboard → Stores → Add store → Request access" },
      ]}
    >
      <Layout>
        {!s.supportAccess && (
          <Layout.Section><Banner tone="warning" title="Clientul a oprit accesul echipei de suport">Poți doar citi informațiile de bază. Cere-i să pornească „Acces pentru echipa Picklo” din Picklo → Ajutor.</Banner></Layout.Section>
        )}
        {!o.installed && <Layout.Section><Banner tone="critical">Aplicația nu mai e instalată în acest magazin — acțiunile care folosesc Shopify nu vor funcționa.</Banner></Layout.Section>}

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
            <Box padding="400">
              {tab === 0 && (
                <BlockStack gap="400">
                  <InlineStack gap="300" wrap>
                    {["pending", "generated", "in_transit", "out_for_delivery", "delivered", "returned", "failed"].map((k) => (
                      <Box key={k} minWidth="120px"><Card><BlockStack gap="050"><Text tone="subdued">{k}</Text><Text variant="headingLg" as="p">{o.statusCounts[k] || 0}</Text></BlockStack></Card></Box>
                    ))}
                  </InlineStack>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd">Configurare</Text>
                      <Text>Checkout: <strong>{s.checkoutMode || "neconfigurat"}</strong> · lockere în checkout: {s.checkoutLockerCount}</Text>
                      <Text>Curieri: {["fan", "sameday", "cargus", "gls", "packeta", "dpd"].filter((c) => s[`${c}Enabled`]).join(", ") || "niciunul"}</Text>
                      <Text>Facturare: {s.invoiceProvider || "dezactivată"} · AWB automat: {s.autoGenerateAwb ? `da (${s.autoAwbFilter})` : "nu"}</Text>
                      <Text>Expeditor: {[s.senderName, s.senderCity, s.senderCounty].filter(Boolean).join(", ") || <Text as="span" tone="critical">lipsă</Text>}</Text>
                      <Text tone="subdued">Permisiuni Shopify: {o.scopes.join(", ") || "—"}</Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="headingMd">Widget-ul din coș</Text>
                        <Button onClick={() => run("theme-status")} loading={busyIntent === "theme-status"}>Verifică temele</Button>
                      </InlineStack>
                      <Text tone="subdued">Shopify nu permite aplicațiilor să scrie direct în temă. Trimite clientului linkul: editorul se deschide pe pagina coșului cu blocul Picklo deja adăugat, el apasă doar Salvează. Cu acces colaborator îl poți deschide și tu.</Text>
                      {themes && themes.map((t) => (
                        <InlineStack key={t.id} align="space-between" blockAlign="center" wrap>
                          <InlineStack gap="200">
                            <Text fontWeight="semibold">{t.name}</Text>
                            {t.live && <Badge tone="info">publicată</Badge>}
                            {!t.supportsAppBlocks ? <Badge tone="critical">temă veche (fără app blocks)</Badge> : t.blockAdded ? <Badge tone="success">widget instalat</Badge> : <Badge tone="warning">widget lipsă</Badge>}
                          </InlineStack>
                          {t.supportsAppBlocks && !t.blockAdded && (
                            <InlineStack gap="200">
                              <Button onClick={() => copy(t.editorUrl)}>Copiază linkul pentru client</Button>
                              <Button url={t.editorUrl} external>Deschide editorul</Button>
                            </InlineStack>
                          )}
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingMd">Acțiuni de suport</Text>
                      <InlineStack gap="200" wrap>
                        {["setup-checkout", "resync-rates", "sync-orders", "refresh-tracking", "cod-guard", "refresh-points"].map((a) => (
                          <Button key={a} onClick={() => run(a)} loading={busyIntent === a} disabled={!s.supportAccess}>{actions[a]}</Button>
                        ))}
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Text>Plan:</Text>
                        <Button onClick={() => run("set-plan", { plan: "lifetime" })} disabled={!s.supportAccess || s.planType === "lifetime"}>Dă lifetime gratuit</Button>
                        <Button tone="critical" variant="plain" onClick={() => run("set-plan", { plan: "trial" })} disabled={!s.supportAccess || s.planType === "trial"}>Înapoi la trial</Button>
                      </InlineStack>
                      {actionData && !actionData.themes && (
                        <Banner tone={actionData.ok ? "success" : "critical"}>{actionData.ok ? actionData.message : actionData.error}</Banner>
                      )}
                    </BlockStack>
                  </Card>
                  {o.recentSkips.length > 0 && (
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingMd">AWB-uri automate oprite recent</Text>
                        {o.recentSkips.map((a) => <Text key={a.id} tone="subdued">{fmt(a.createdAt)} · {a.orderName} · {a.message}</Text>)}
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              )}

              {tab === 1 && (
                <BlockStack gap="400">
                  <Banner tone="info">Credențialele curierilor și ale facturării nu se văd și nu se pot schimba de aici — le introduce doar clientul. Orice salvare apare în istoricul magazinului, cu numele tău.</Banner>
                  <Text variant="headingSm">Opțiuni</Text>
                  <InlineStack gap="400" wrap>
                    {editable.booleans.map((k) => (
                      <Box key={k} minWidth="260px"><Checkbox label={LABELS[k] || k} checked={!!form[k]} onChange={(v) => setForm({ ...form, [k]: v })} /></Box>
                    ))}
                  </InlineStack>
                  <Divider />
                  <Text variant="headingSm">Valori</Text>
                  <InlineStack gap="300" wrap>
                    {[...editable.numbers, ...editable.strings].map((k) => (
                      <Box key={k} minWidth="220px">
                        {["autoAwbFilter", "onCancelInvoice", "onReturnedInvoice", "freeShippingScope", "invoiceProvider", "defaultCourier"].includes(k) ? (
                          <Select label={k} value={String(form[k] ?? "")} onChange={(v) => setForm({ ...form, [k]: v })} options={{
                            autoAwbFilter: ["all", "cod", "paid", "pickup"], onCancelInvoice: ["none", "cancel", "reverse"], onReturnedInvoice: ["none", "cancel", "reverse"],
                            freeShippingScope: ["all", "pickup"], invoiceProvider: ["", "smartbill", "oblio", "fgo"], defaultCourier: ["fan", "sameday", "cargus", "gls", "packeta", "dpd"],
                          }[k].map((v) => ({ label: v || "—", value: v }))} />
                        ) : (
                          <TextField label={k} value={String(form[k] ?? "")} onChange={(v) => setForm({ ...form, [k]: v })} autoComplete="off" />
                        )}
                      </Box>
                    ))}
                  </InlineStack>
                  <InlineStack gap="200">
                    <Button variant="primary" disabled={!dirty.length || !s.supportAccess} loading={busyIntent === "update-settings"}
                      onClick={() => run("update-settings", Object.fromEntries(dirty.map((k) => [k, String(form[k] ?? "")])))}>
                      {dirty.length ? `Salvează ${dirty.length} modificări` : "Nicio modificare"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}

              {tab === 2 && (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "numeric", "text"]}
                  headings={["Comandă", "Client", "Curier", "AWB", "Status", "Ramburs", "Factură"]}
                  rows={o.recentOrders.map((r) => [r.shopifyOrderName, r.customerName, `${r.courierType}${r.shippingMethod === "pickup_point" ? " · locker" : ""}`,
                    r.awbNumber || "—", r.awbStatus, r.codAmount ? r.codAmount.toFixed(2) : "—", r.invoiceNumber ? `${r.invoiceSeries}${r.invoiceNumber}` : "—"])}
                />
              )}

              {tab === 3 && (
                <BlockStack gap="150">
                  {o.activity.length === 0 ? <Text tone="subdued">Nimic încă.</Text> : o.activity.map((a) => (
                    <InlineStack key={a.id} gap="300" wrap={false}>
                      <Box minWidth="120px"><Text tone="subdued" variant="bodySm">{fmt(a.createdAt)}</Text></Box>
                      <Box minWidth="70px"><Text variant="bodySm" fontWeight="semibold">{a.orderName || "—"}</Text></Box>
                      <Text variant="bodySm">{a.message}{a.actor ? ` · ${a.actor}` : ""}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd">Tichete</Text>
              {o.tickets.length === 0 ? <Text tone="subdued">Niciun tichet.</Text> : o.tickets.map((t) => (
                <InlineStack key={t.id} align="space-between" wrap={false}>
                  <Button variant="plain" url={`/hq/tickets/${t.id}`}>{t.subject}</Button>
                  <Badge tone={t.status === "resolved" ? "success" : "attention"}>{STATUSES[t.status]}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </Page>
  );
}
