// app/routes/app.settings.jsx
// Settings — Expeditor, FAN Courier, Sameday, xConnector, Widget

import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";
import { samedayAuthenticate } from "../services/sameday.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField,
  Button, Checkbox, Select, Badge, Banner, Divider, Tabs,
  Form as PolarisForm, FormLayout, Box, Toast, Frame,
} from "@shopify/polaris";

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
  });
  return json({ settings: settings || {}, shop: session.shop });
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // ── Test connections ──────────────────────────────────────────────────────
  if (intent === "test-fan") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await fanAuthenticate({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
      });
      return json({ testResult: { courier: "fan", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "fan", success: false, error: e.message } });
    }
  }

  if (intent === "test-sameday") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await samedayAuthenticate({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
      });
      return json({ testResult: { courier: "sameday", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "sameday", success: false, error: e.message } });
    }
  }

  if (intent === "refresh-pickup-points") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      const result = await refreshPickupPointsCache({ settings });
      return json({ refreshResult: result });
    } catch (e) {
      return json({ refreshResult: { errors: [e.message] } });
    }
  }

  // ── Save settings ─────────────────────────────────────────────────────────
  if (intent === "save") {
    const get = (k) => formData.get(k);

    const data = {
      // Sender
      senderName:    get("senderName"),
      senderCounty:  get("senderCounty"),
      senderCity:    get("senderCity"),
      senderZip:     get("senderZip"),
      senderAddress: get("senderAddress"),
      senderPhone:   get("senderPhone"),
      senderEmail:   get("senderEmail"),
      // FAN
      fanClientId:  get("fanClientId"),
      fanUsername:  get("fanUsername"),
      fanEnabled:   get("fanEnabled") === "true",
      // Sameday
      samedayUsername: get("samedayUsername"),
      samedayEnabled:  get("samedayEnabled") === "true",
      // xConnector
      xconnectorEnabled: get("xconnectorEnabled") === "true",
      // Widget
      defaultCourier:  get("defaultCourier") || "fan",
      defaultWeight:   parseFloat(get("defaultWeight")) || 1,
      autoGenerateAwb: get("autoGenerateAwb") === "true",
      showPickupMap:   get("showPickupMap") === "true",
    };

    // Only update passwords if provided (non-empty)
    const fanPw = get("fanPassword");
    if (fanPw) data.fanPassword = fanPw;

    const samedayPw = get("samedayPassword");
    if (samedayPw) data.samedayPassword = samedayPw;

    const xPw = get("xconnectorApiKey");
    if (xPw) data.xconnectorApiKey = xPw;

    await prisma.shopSettings.upsert({
      where:  { shop: session.shop },
      update: data,
      create: { shop: session.shop, ...data },
    });

    return json({ saved: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Settings() {
  const { settings, shop } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState(null);

  // Show toast on save
  if (actionData?.saved && !toast) setToast("✅ Setările au fost salvate!");
  if (actionData?.testResult?.success && !toast) setToast("✅ Conexiune reușită!");
  if (actionData?.refreshResult && !toast) {
    const r = actionData.refreshResult;
    setToast(r.errors?.length
      ? `⚠️ Erori: ${r.errors.join(", ")}`
      : `✅ ${r.fan || 0} FANbox + ${r.sameday || 0} Sameday puncte actualizate`
    );
  }

  const tabs = [
    { id: "sender",     content: "📦 Expeditor"    },
    { id: "fan",        content: "🚛 FAN Courier"   },
    { id: "sameday",    content: "📬 Sameday"       },
    { id: "xconnector", content: "🔗 xConnector"   },
    { id: "widget",     content: "🛒 Widget coș"   },
  ];

  // Helper for section input
  function InputRow({ label, name, value, type = "text", helpText, placeholder }) {
    return (
      <TextField
        label={label}
        name={name}
        defaultValue={value || ""}
        type={type}
        helpText={helpText}
        placeholder={placeholder}
        autoComplete="off"
      />
    );
  }

  return (
    <Frame>
      <Page title="Setări RoCourier" subtitle={shop}>
        <Form method="post">
          <input type="hidden" name="intent" value="save" />

          <Layout>
            <Layout.Section>
              <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
                <Box paddingBlockStart="400">

                  {/* ── TAB 0: Expeditor ────────────────────────────────── */}
                  {tab === 0 && (
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">Date expeditor (sender)</Text>
                        <Text tone="subdued">
                          Aceste date apar pe toate AWB-urile ca adresă de retur.
                        </Text>
                        <Divider />
                        <FormLayout>
                          <InputRow label="Nume firmă / expeditor" name="senderName" value={settings.senderName} />
                          <FormLayout.Group>
                            <InputRow label="Județ" name="senderCounty" value={settings.senderCounty} placeholder="ex: Constanta" />
                            <InputRow label="Localitate" name="senderCity" value={settings.senderCity} placeholder="ex: Constanta" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <InputRow label="Cod poștal" name="senderZip" value={settings.senderZip} placeholder="ex: 900205" />
                            <InputRow label="Adresă stradă" name="senderAddress" value={settings.senderAddress} placeholder="ex: Str. Poporului 76" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <InputRow label="Telefon" name="senderPhone" value={settings.senderPhone} placeholder="+40..." />
                            <InputRow label="Email" name="senderEmail" value={settings.senderEmail} type="email" />
                          </FormLayout.Group>
                        </FormLayout>
                      </BlockStack>
                    </Card>
                  )}

                  {/* ── TAB 1: FAN Courier ──────────────────────────────── */}
                  {tab === 1 && (
                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between">
                            <Text variant="headingMd" fontWeight="semibold">FAN Courier — selfAWB API</Text>
                            {settings.fanEnabled
                              ? <Badge tone="success">Activ</Badge>
                              : <Badge tone="critical">Inactiv</Badge>}
                          </InlineStack>

                          <Banner tone="info" title="Cum obții credențialele FAN Courier">
                            <BlockStack gap="100">
                              <Text>1. Creează cont pe <strong>selfawb.ro</strong></Text>
                              <Text>2. Semnează contractul cu FAN Courier</Text>
                              <Text>3. În selfAWB: Profil → Generare Token API</Text>
                              <Text>4. Copiază <strong>Client ID</strong>, <strong>Username</strong> și <strong>Parolă</strong> mai jos</Text>
                              <Text>Contact: <strong>selfawb@fancourier.ro</strong></Text>
                            </BlockStack>
                          </Banner>

                          <Divider />
                          <FormLayout>
                            <Checkbox
                              label="Activează FAN Courier"
                              name="fanEnabled"
                              value="true"
                              checked={settings.fanEnabled}
                            />
                            <InputRow
                              label="Client ID (numeric)"
                              name="fanClientId"
                              value={settings.fanClientId}
                              placeholder="ex: 7032158"
                              helpText="Găsit în selfAWB → Profil → API"
                            />
                            <FormLayout.Group>
                              <InputRow label="Username selfAWB" name="fanUsername" value={settings.fanUsername} />
                              <TextField
                                label="Parolă selfAWB"
                                name="fanPassword"
                                type="password"
                                placeholder="Lasă gol pentru a păstra parola existentă"
                                autoComplete="new-password"
                              />
                            </FormLayout.Group>
                          </FormLayout>

                          {actionData?.testResult?.courier === "fan" && (
                            <Banner
                              tone={actionData.testResult.success ? "success" : "critical"}
                              title={actionData.testResult.success ? "Conexiune FAN reușită!" : "Eroare conexiune FAN"}
                            >
                              {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                            </Banner>
                          )}
                        </BlockStack>
                      </Card>

                      {/* Sandbox note */}
                      <Card background="bg-surface-secondary">
                        <BlockStack gap="200">
                          <Text variant="headingSm" fontWeight="semibold">🧪 Date test (sandbox)</Text>
                          <Text variant="bodySm" tone="subdued">
                            Client ID: <code>7032158</code> &nbsp;|&nbsp;
                            Username: <code>clienttest</code> &nbsp;|&nbsp;
                            Parolă: <code>testing</code>
                          </Text>
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  )}

                  {/* ── TAB 2: Sameday ──────────────────────────────────── */}
                  {tab === 2 && (
                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between">
                            <Text variant="headingMd" fontWeight="semibold">Sameday Courier — eAWB API</Text>
                            {settings.samedayEnabled
                              ? <Badge tone="success">Activ</Badge>
                              : <Badge tone="critical">Inactiv</Badge>}
                          </InlineStack>

                          <Banner tone="info" title="Cum obții credențialele Sameday">
                            <BlockStack gap="100">
                              <Text>1. Semnează contract cu Sameday Courier</Text>
                              <Text>2. Trimite email la <strong>software@sameday.ro</strong></Text>
                              <Text>3. Menționează că vrei acces la <strong>eAWB API</strong></Text>
                              <Text>4. Vei primi username & parolă pentru <strong>eawb.sameday.ro</strong></Text>
                              <Text>Sandbox: <strong>sameday-api.demo.zitec.com</strong></Text>
                            </BlockStack>
                          </Banner>

                          <Divider />
                          <FormLayout>
                            <Checkbox
                              label="Activează Sameday"
                              name="samedayEnabled"
                              value="true"
                              checked={settings.samedayEnabled}
                            />
                            <FormLayout.Group>
                              <InputRow label="Username eAWB" name="samedayUsername" value={settings.samedayUsername} />
                              <TextField
                                label="Parolă eAWB"
                                name="samedayPassword"
                                type="password"
                                placeholder="Lasă gol pentru a păstra parola existentă"
                                autoComplete="new-password"
                              />
                            </FormLayout.Group>
                          </FormLayout>

                          {actionData?.testResult?.courier === "sameday" && (
                            <Banner
                              tone={actionData.testResult.success ? "success" : "critical"}
                              title={actionData.testResult.success ? "Conexiune Sameday reușită!" : "Eroare conexiune Sameday"}
                            >
                              {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                            </Banner>
                          )}
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  )}

                  {/* ── TAB 3: xConnector ───────────────────────────────── */}
                  {tab === 3 && (
                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="400">
                          <Text variant="headingMd" fontWeight="semibold">Integrare xConnector</Text>

                          <Banner tone="info" title="Cum funcționează integrarea cu xConnector">
                            <BlockStack gap="200">
                              <Text>
                                <strong>xConnector</strong> (de la InfoQuest) este o aplicație Shopify separată —
                                nu are un API public deschis.
                              </Text>
                              <Text>
                                <strong>RoCourier este deja compatibil cu xConnector</strong> fără configurare
                                suplimentară: AWB-urile generate sunt scrise automat în câmpurile native
                                Shopify (Fulfillment tracking number + Order metafields) pe care xConnector
                                le citește.
                              </Text>
                              <Text>
                                Dacă ai nevoie de integrare directă, contactează InfoQuest la:
                                <strong> office@infoquest.ro</strong>
                              </Text>
                            </BlockStack>
                          </Banner>

                          <Divider />
                          <FormLayout>
                            <Checkbox
                              label="Activează sync xConnector (experimental)"
                              name="xconnectorEnabled"
                              value="true"
                              checked={settings.xconnectorEnabled}
                            />
                            <TextField
                              label="API Key xConnector (partner key)"
                              name="xconnectorApiKey"
                              type="password"
                              placeholder="Lasă gol dacă nu ai un key de partener"
                              helpText="Disponibil doar după acordul de parteneriat cu InfoQuest"
                              autoComplete="new-password"
                            />
                          </FormLayout>
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  )}

                  {/* ── TAB 4: Widget ────────────────────────────────────── */}
                  {tab === 4 && (
                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="400">
                          <Text variant="headingMd" fontWeight="semibold">Setări widget coș de cumpărături</Text>
                          <Divider />
                          <FormLayout>
                            <Select
                              label="Curier implicit"
                              name="defaultCourier"
                              value={settings.defaultCourier || "fan"}
                              options={[
                                { label: "FAN Courier", value: "fan" },
                                { label: "Sameday",     value: "sameday" },
                              ]}
                              helpText="Curier pre-selectat dacă clientul nu alege manual"
                            />
                            <TextField
                              label="Greutate implicită (kg)"
                              name="defaultWeight"
                              type="number"
                              defaultValue={String(settings.defaultWeight || 1)}
                              min="0.1"
                              step="0.1"
                              suffix="kg"
                              helpText="Greutatea folosită dacă nu e specificată per produs"
                            />
                            <Checkbox
                              label="Arată harta la selectarea punctului de ridicare"
                              name="showPickupMap"
                              value="true"
                              checked={settings.showPickupMap !== false}
                            />
                            <Checkbox
                              label="Generează AWB automat la primirea comenzii"
                              name="autoGenerateAwb"
                              value="true"
                              checked={settings.autoGenerateAwb}
                              helpText="Activează cu grijă — orice comandă va genera imediat un AWB"
                            />
                          </FormLayout>
                        </BlockStack>
                      </Card>

                      {/* Pickup points cache management */}
                      <Card>
                        <BlockStack gap="300">
                          <Text variant="headingMd" fontWeight="semibold">Cache puncte de ridicare</Text>
                          <Text tone="subdued">
                            Punctele FANbox și Sameday easybox sunt salvate local și reîmprospătate
                            automat la 24h. Poți forța reîmprospătarea manual mai jos.
                          </Text>
                          {actionData?.refreshResult && (
                            <Banner
                              tone={actionData.refreshResult.errors?.length ? "warning" : "success"}
                              title="Rezultat reîmprospătare"
                            >
                              <Text>
                                FAN: {actionData.refreshResult.fan || 0} puncte,
                                Sameday: {actionData.refreshResult.sameday || 0} puncte
                                {actionData.refreshResult.errors?.length > 0
                                  ? ` — Erori: ${actionData.refreshResult.errors.join(", ")}`
                                  : ""}
                              </Text>
                            </Banner>
                          )}
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  )}

                </Box>
              </Tabs>
            </Layout.Section>

            {/* ── Save + Test buttons ─────────────────────────────────── */}
            <Layout.Section>
              <Card>
                <InlineStack gap="300" align="start">
                  <Button submit variant="primary" size="large" loading={saving}>
                    Salvează setările
                  </Button>
                  {tab === 1 && (
                    <Button
                      name="intent" value="test-fan"
                      onClick={(e) => {
                        e.preventDefault();
                        const f = document.createElement("form");
                        f.method = "post";
                        f.innerHTML = '<input name="intent" value="test-fan">';
                        document.body.appendChild(f);
                        f.submit();
                      }}
                    >
                      🔌 Testează conexiunea FAN
                    </Button>
                  )}
                  {tab === 2 && (
                    <Button
                      onClick={(e) => {
                        e.preventDefault();
                        const f = document.createElement("form");
                        f.method = "post";
                        f.innerHTML = '<input name="intent" value="test-sameday">';
                        document.body.appendChild(f);
                        f.submit();
                      }}
                    >
                      🔌 Testează conexiunea Sameday
                    </Button>
                  )}
                  {tab === 4 && (
                    <Button
                      onClick={(e) => {
                        e.preventDefault();
                        const f = document.createElement("form");
                        f.method = "post";
                        f.innerHTML = '<input name="intent" value="refresh-pickup-points">';
                        document.body.appendChild(f);
                        f.submit();
                      }}
                    >
                      🔄 Reîmprospătează puncte ridicare
                    </Button>
                  )}
                </InlineStack>
              </Card>
            </Layout.Section>

          </Layout>
        </Form>

        {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}
