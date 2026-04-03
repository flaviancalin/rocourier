// app/routes/app.settings.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";
import { samedayAuthenticate } from "../services/sameday.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState, useCallback, useEffect } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField,
  Button, Checkbox, Select, Badge, Banner, Divider, Tabs,
  FormLayout, Box, Frame, Toast,
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
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "test-fan") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await fanAuthenticate({ clientId: settings.fanClientId, username: settings.fanUsername, password: settings.fanPassword });
      return json({ testResult: { courier: "fan", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "fan", success: false, error: e.message } });
    }
  }

  if (intent === "test-sameday") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await samedayAuthenticate({ username: settings.samedayUsername, password: settings.samedayPassword });
      return json({ testResult: { courier: "sameday", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "sameday", success: false, error: e.message } });
    }
  }

  if (intent === "carrier-register") {
    const APP_URL = (process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app").replace(/\/$/, "");
    const CALLBACK_URL = `${APP_URL}/carrier-service`;
    try {
      // Use Shopify Admin REST API via fetch with the session token
      const shop = session.shop;
      const token = session.accessToken;
      const apiVersion = "2024-10";

      // Check existing carrier services
      const checkRes = await fetch(
        `https://${shop}/admin/api/${apiVersion}/carrier_services.json`,
        { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
      );
      const checkData = await checkRes.json();
      const existing = checkData.carrier_services || [];
      const ours = existing.find((cs) => cs.callback_url === CALLBACK_URL);
      if (ours) {
        return json({ carrierResult: { success: true, alreadyRegistered: true, id: ours.id } });
      }

      // Register new carrier service
      const createRes = await fetch(
        `https://${shop}/admin/api/${apiVersion}/carrier_services.json`,
        {
          method: "POST",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ carrier_service: { name: "RoCourier", callback_url: CALLBACK_URL, service_discovery: true } }),
        }
      );
      const createData = await createRes.json();
      const cs = createData.carrier_service;
      if (cs?.id) {
        return json({ carrierResult: { success: true, id: cs.id } });
      }
      return json({ carrierResult: { success: false, error: JSON.stringify(createData) } });
    } catch (e) {
      return json({ carrierResult: { success: false, error: String(e) } });
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

  if (intent === "save") {
    const get = (k) => formData.get(k);
    const data = {
      senderName:    get("senderName") || "",
      senderCounty:  get("senderCounty") || "",
      senderCity:    get("senderCity") || "",
      senderZip:     get("senderZip") || "",
      senderAddress: get("senderAddress") || "",
      senderPhone:   get("senderPhone") || "",
      senderEmail:   get("senderEmail") || "",
      fanClientId:   get("fanClientId") || "",
      fanUsername:   get("fanUsername") || "",
      fanEnabled:    get("fanEnabled") === "true",
      samedayUsername: get("samedayUsername") || "",
      samedayEnabled:  get("samedayEnabled") === "true",
      xconnectorEnabled: get("xconnectorEnabled") === "true",
      defaultCourier:  get("defaultCourier") || "fan",
      defaultWeight:   parseFloat(get("defaultWeight")) || 1,
      autoGenerateAwb: get("autoGenerateAwb") === "true",
      showPickupMap:   get("showPickupMap") === "true",
      fanHomeDeliveryFee:     parseFloat(get("fanHomeDeliveryFee"))     || 0,
      fanPickupFee:           parseFloat(get("fanPickupFee"))           || 0,
      samedayHomeDeliveryFee: parseFloat(get("samedayHomeDeliveryFee")) || 0,
      samedayPickupFee:       parseFloat(get("samedayPickupFee"))       || 0,
    };
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
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState(null);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [senderName,    setSenderName]    = useState(settings.senderName    || "");
  const [senderCounty,  setSenderCounty]  = useState(settings.senderCounty  || "");
  const [senderCity,    setSenderCity]    = useState(settings.senderCity     || "");
  const [senderZip,     setSenderZip]     = useState(settings.senderZip     || "");
  const [senderAddress, setSenderAddress] = useState(settings.senderAddress  || "");
  const [senderPhone,   setSenderPhone]   = useState(settings.senderPhone   || "");
  const [senderEmail,   setSenderEmail]   = useState(settings.senderEmail   || "");

  const [fanEnabled,  setFanEnabled]  = useState(!!settings.fanEnabled);
  const [fanClientId, setFanClientId] = useState(settings.fanClientId  || "");
  const [fanUsername, setFanUsername] = useState(settings.fanUsername  || "");
  const [fanPassword, setFanPassword] = useState("");

  const [samedayEnabled,  setSamedayEnabled]  = useState(!!settings.samedayEnabled);
  const [samedayUsername, setSamedayUsername] = useState(settings.samedayUsername || "");
  const [samedayPassword, setSamedayPassword] = useState("");

  const [xconnectorEnabled, setXconnectorEnabled] = useState(!!settings.xconnectorEnabled);
  const [xconnectorApiKey,  setXconnectorApiKey]  = useState("");

  const [defaultCourier,  setDefaultCourier]  = useState(settings.defaultCourier  || "fan");
  const [defaultWeight,   setDefaultWeight]   = useState(String(settings.defaultWeight || 1));
  const [showPickupMap,   setShowPickupMap]   = useState(settings.showPickupMap !== false);
  const [autoGenerateAwb, setAutoGenerateAwb] = useState(!!settings.autoGenerateAwb);

  const [fanHomeDeliveryFee,     setFanHomeDeliveryFee]     = useState(String(settings.fanHomeDeliveryFee     ?? 0));
  const [fanPickupFee,           setFanPickupFee]           = useState(String(settings.fanPickupFee           ?? 0));
  const [samedayHomeDeliveryFee, setSamedayHomeDeliveryFee] = useState(String(settings.samedayHomeDeliveryFee ?? 0));
  const [samedayPickupFee,       setSamedayPickupFee]       = useState(String(settings.samedayPickupFee       ?? 0));

  const [carrierStatus, setCarrierStatus] = useState(null); // null | "loading" | "registered" | "error"
  const [carrierMsg,    setCarrierMsg]    = useState("");

  // ── Toasts ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (actionData?.saved) setToast("✅ Setările au fost salvate!");
    else if (actionData?.testResult?.success) setToast("✅ Conexiune reușită!");
    else if (actionData?.testResult?.success === false) setToast(`❌ ${actionData.testResult.error}`);
    else if (actionData?.carrierResult) {
      const r = actionData.carrierResult;
      if (r.success) {
        setCarrierStatus("registered");
        setCarrierMsg(r.alreadyRegistered ? "Serviciul era deja înregistrat." : "Serviciu de transport înregistrat cu succes!");
      } else {
        setCarrierStatus("error");
        setCarrierMsg(r.error || "Eroare necunoscută.");
      }
    }
    else if (actionData?.refreshResult) {
      const r = actionData.refreshResult;
      setToast(r.errors?.length
        ? `⚠️ Erori: ${r.errors.join(", ")}`
        : `✅ ${r.fan || 0} FANbox + ${r.sameday || 0} Sameday puncte`);
    }
  }, [actionData]);

  // ── Save handler ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const data = {
      intent: "save",
      senderName, senderCounty, senderCity, senderZip, senderAddress, senderPhone, senderEmail,
      fanEnabled: String(fanEnabled), fanClientId, fanUsername,
      samedayEnabled: String(samedayEnabled), samedayUsername,
      xconnectorEnabled: String(xconnectorEnabled),
      defaultCourier, defaultWeight,
      showPickupMap: String(showPickupMap),
      autoGenerateAwb: String(autoGenerateAwb),
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee,
    };
    if (fanPassword) data.fanPassword = fanPassword;
    if (samedayPassword) data.samedayPassword = samedayPassword;
    if (xconnectorApiKey) data.xconnectorApiKey = xconnectorApiKey;
    submit(data, { method: "post" });
  }, [senderName, senderCounty, senderCity, senderZip, senderAddress, senderPhone, senderEmail,
      fanEnabled, fanClientId, fanUsername, fanPassword, samedayEnabled, samedayUsername,
      samedayPassword, xconnectorEnabled, xconnectorApiKey, defaultCourier, defaultWeight,
      showPickupMap, autoGenerateAwb,
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee, submit]);

  const handleTest = useCallback((courier) => {
    submit({ intent: `test-${courier}` }, { method: "post" });
  }, [submit]);

  const handleRefresh = useCallback(() => {
    submit({ intent: "refresh-pickup-points" }, { method: "post" });
  }, [submit]);

  const handleCarrierRegister = useCallback(() => {
    setCarrierStatus("loading");
    submit({ intent: "carrier-register" }, { method: "post" });
  }, [submit]);

  const tabs = [
    { id: "sender",     content: "📦 Expeditor"   },
    { id: "fan",        content: "🚛 FAN Courier"  },
    { id: "sameday",    content: "📬 Sameday"      },
    { id: "xconnector", content: "🔗 xConnector"  },
    { id: "widget",     content: "🛒 Widget coș"  },
  ];

  return (
    <Frame>
      <Page title="Setări RoCourier" subtitle={shop}>
        <Layout>
          <Layout.Section>
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
              <Box paddingBlockStart="400">

                {/* ── TAB 0: Expeditor ──────────────────────────────────── */}
                {tab === 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" fontWeight="semibold">Date expeditor (sender)</Text>
                      <Text tone="subdued">Aceste date apar pe toate AWB-urile ca adresă de retur.</Text>
                      <Divider />
                      <FormLayout>
                        <TextField label="Nume firmă / expeditor" value={senderName} onChange={setSenderName} autoComplete="off" />
                        <FormLayout.Group>
                          <TextField label="Județ" value={senderCounty} onChange={setSenderCounty} placeholder="ex: Constanta" autoComplete="off" />
                          <TextField label="Localitate" value={senderCity} onChange={setSenderCity} placeholder="ex: Constanta" autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label="Cod poștal" value={senderZip} onChange={setSenderZip} placeholder="ex: 900205" autoComplete="off" />
                          <TextField label="Adresă stradă" value={senderAddress} onChange={setSenderAddress} placeholder="ex: Str. Poporului 76" autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label="Telefon" value={senderPhone} onChange={setSenderPhone} placeholder="+40..." autoComplete="off" />
                          <TextField label="Email" value={senderEmail} onChange={setSenderEmail} type="email" autoComplete="off" />
                        </FormLayout.Group>
                      </FormLayout>
                    </BlockStack>
                  </Card>
                )}

                {/* ── TAB 1: FAN Courier ────────────────────────────────── */}
                {tab === 1 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">FAN Courier — selfAWB API</Text>
                          {fanEnabled ? <Badge tone="success">Activ</Badge> : <Badge tone="critical">Inactiv</Badge>}
                        </InlineStack>
                        <Banner tone="info" title="Cum obții credențialele FAN Courier">
                          <BlockStack gap="100">
                            <Text>1. Creează cont pe <strong>selfawb.ro</strong></Text>
                            <Text>2. Semnează contractul cu FAN Courier</Text>
                            <Text>3. În selfAWB: Profil → Generare Token API</Text>
                            <Text>4. Copiază <strong>Client ID</strong>, <strong>Username</strong> și <strong>Parolă</strong> mai jos</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label="Activează FAN Courier" checked={fanEnabled} onChange={setFanEnabled} />
                          <TextField label="Client ID (numeric)" value={fanClientId} onChange={setFanClientId} placeholder="ex: 7032158" helpText="Găsit în selfAWB → Profil → API" autoComplete="off" />
                          <FormLayout.Group>
                            <TextField label="Username selfAWB" value={fanUsername} onChange={setFanUsername} autoComplete="off" />
                            <TextField label="Parolă selfAWB" value={fanPassword} onChange={setFanPassword} type="password" placeholder="Lasă gol pentru a păstra parola existentă" autoComplete="new-password" />
                          </FormLayout.Group>
                        </FormLayout>
                        {actionData?.testResult?.courier === "fan" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? "Conexiune FAN reușită!" : "Eroare conexiune FAN"}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingSm" fontWeight="semibold">🧪 Date test (sandbox)</Text>
                        <Text variant="bodySm" tone="subdued">
                          Client ID: <code>7032158</code> &nbsp;|&nbsp; Username: <code>clienttest</code> &nbsp;|&nbsp; Parolă: <code>testing</code>
                        </Text>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 2: Sameday ────────────────────────────────────── */}
                {tab === 2 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">Sameday Courier — eAWB API</Text>
                          {samedayEnabled ? <Badge tone="success">Activ</Badge> : <Badge tone="critical">Inactiv</Badge>}
                        </InlineStack>
                        <Banner tone="info" title="Cum obții credențialele Sameday">
                          <BlockStack gap="100">
                            <Text>1. Semnează contract cu Sameday Courier</Text>
                            <Text>2. Trimite email la <strong>software@sameday.ro</strong></Text>
                            <Text>3. Menționează că vrei acces la <strong>eAWB API</strong></Text>
                            <Text>4. Vei primi username & parolă pentru <strong>eawb.sameday.ro</strong></Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label="Activează Sameday" checked={samedayEnabled} onChange={setSamedayEnabled} />
                          <FormLayout.Group>
                            <TextField label="Username eAWB" value={samedayUsername} onChange={setSamedayUsername} autoComplete="off" />
                            <TextField label="Parolă eAWB" value={samedayPassword} onChange={setSamedayPassword} type="password" placeholder="Lasă gol pentru a păstra parola existentă" autoComplete="new-password" />
                          </FormLayout.Group>
                        </FormLayout>
                        {actionData?.testResult?.courier === "sameday" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? "Conexiune Sameday reușită!" : "Eroare conexiune Sameday"}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 3: xConnector ─────────────────────────────────── */}
                {tab === 3 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">Integrare xConnector</Text>
                        <Banner tone="info" title="Cum funcționează integrarea cu xConnector">
                          <BlockStack gap="200">
                            <Text><strong>RoCourier este deja compatibil cu xConnector</strong> fără configurare suplimentară: AWB-urile generate sunt scrise automat în câmpurile native Shopify pe care xConnector le citește.</Text>
                            <Text>Pentru integrare directă contactează InfoQuest: <strong>office@infoquest.ro</strong></Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label="Activează sync xConnector (experimental)" checked={xconnectorEnabled} onChange={setXconnectorEnabled} />
                          <TextField label="API Key xConnector (partner key)" value={xconnectorApiKey} onChange={setXconnectorApiKey} type="password" placeholder="Lasă gol dacă nu ai un key de partener" helpText="Disponibil doar după acordul de parteneriat cu InfoQuest" autoComplete="new-password" />
                        </FormLayout>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 4: Widget ─────────────────────────────────────── */}
                {tab === 4 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">Setări widget coș de cumpărături</Text>
                        <Divider />
                        <FormLayout>
                          <Select
                            label="Curier implicit"
                            value={defaultCourier}
                            onChange={setDefaultCourier}
                            options={[
                              { label: "FAN Courier", value: "fan" },
                              { label: "Sameday",     value: "sameday" },
                            ]}
                            helpText="Curier pre-selectat dacă clientul nu alege manual"
                          />
                          <TextField
                            label="Greutate implicită (kg)"
                            value={defaultWeight}
                            onChange={setDefaultWeight}
                            type="number"
                            min="0.1"
                            step="0.1"
                            suffix="kg"
                            helpText="Greutatea folosită dacă nu e specificată per produs"
                            autoComplete="off"
                          />
                          <Checkbox label="Arată harta la selectarea punctului de ridicare" checked={showPickupMap} onChange={setShowPickupMap} />
                          <Checkbox label="Generează AWB automat la primirea comenzii" checked={autoGenerateAwb} onChange={setAutoGenerateAwb} helpText="Activează cu grijă — orice comandă va genera imediat un AWB" />
                        </FormLayout>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">Cache puncte de ridicare</Text>
                        <Text tone="subdued">Punctele FANbox și Sameday easybox sunt salvate local și reîmprospătate automat la 24h.</Text>
                        {actionData?.refreshResult && (
                          <Banner tone={actionData.refreshResult.errors?.length ? "warning" : "success"} title="Rezultat reîmprospătare">
                            <Text>FAN: {actionData.refreshResult.fan || 0} puncte, Sameday: {actionData.refreshResult.sameday || 0} puncte</Text>
                          </Banner>
                        )}
                        <Button onClick={handleRefresh} loading={saving}>🔄 Reîmprospătează puncte ridicare</Button>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">Transport în checkout</Text>
                        <Banner tone="info" title="Cum configurezi tarifele de transport">
                          <BlockStack gap="200">
                            <Text>Widgetul salvează alegerea clientului (metodă + punct de ridicare) în atributele coșului. Acestea apar pe comandă în Shopify Admin.</Text>
                            <Text>Pentru a afișa tarifele de transport în checkout, configurează <strong>rate manuale</strong> în Shopify:</Text>
                            <BlockStack gap="100">
                              <Text>1. Shopify Admin → <strong>Settings → Shipping and delivery</strong></Text>
                              <Text>2. Click <strong>Manage rates</strong> pe profilul tău de livrare</Text>
                              <Text>3. Adaugă o zonă <strong>Romania</strong> (dacă nu există)</Text>
                              <Text>4. Click <strong>Add rate</strong> → introdu tariful fix (ex: "Livrare standard — 15 RON")</Text>
                            </BlockStack>
                            <Text>Metoda de livrare aleasă de client (FAN / Sameday / locker) va fi vizibilă pe comandă în secțiunea <strong>Note</strong> și <strong>Atribute</strong>.</Text>
                          </BlockStack>
                        </Banner>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

              </Box>
            </Tabs>
          </Layout.Section>

          {/* ── Save + Test buttons ───────────────────────────────────── */}
          <Layout.Section>
            <Card>
              <InlineStack gap="300" align="start">
                <Button variant="primary" size="large" onClick={handleSave} loading={saving}>
                  Salvează setările
                </Button>
                {tab === 1 && (
                  <Button onClick={() => handleTest("fan")} loading={saving}>
                    🔌 Testează conexiunea FAN
                  </Button>
                )}
                {tab === 2 && (
                  <Button onClick={() => handleTest("sameday")} loading={saving}>
                    🔌 Testează conexiunea Sameday
                  </Button>
                )}
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>

        {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}
