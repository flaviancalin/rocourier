// app/routes/app.settings.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";
import { samedayAuthenticate } from "../services/sameday.server.js";
import { cargusAuthenticate } from "../services/cargus.server.js";
import { glsTestConnection } from "../services/gls.server.js";
import { packetaGetPickupPoints } from "../services/packeta.server.js";
import { refreshPickupPointsCache } from "../models/pickup-points.server.js";
import { useState, useCallback, useEffect } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField,
  Button, Checkbox, Select, Badge, Banner, Divider, Tabs,
  FormLayout, Box, Frame, Toast,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";
import { LanguageSwitcher } from "../components/LanguageSwitcher.jsx";

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
      await samedayAuthenticate({ username: settings.samedayUsername, password: settings.samedayPassword, sandbox: !!settings.samedaySandbox });
      return json({ testResult: { courier: "sameday", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "sameday", success: false, error: e.message } });
    }
  }

  if (intent === "test-cargus") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await cargusAuthenticate({ subscriptionKey: settings.cargusSubscriptionKey, username: settings.cargusUsername, password: settings.cargusPassword });
      return json({ testResult: { courier: "cargus", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "cargus", success: false, error: e.message } });
    }
  }

  if (intent === "test-gls") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await glsTestConnection({ username: settings.glsUsername, password: settings.glsPassword, sandbox: !!settings.glsSandbox });
      return json({ testResult: { courier: "gls", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "gls", success: false, error: e.message } });
    }
  }

  if (intent === "test-packeta") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await packetaGetPickupPoints({ apiKey: settings.packetaApiKey, country: "ro" });
      return json({ testResult: { courier: "packeta", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "packeta", success: false, error: e.message } });
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
          body: JSON.stringify({ carrier_service: { name: "Picklo", callback_url: CALLBACK_URL, service_discovery: true } }),
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
      samedaySandbox:  get("samedaySandbox") === "true",
      cargusSubscriptionKey: get("cargusSubscriptionKey") || "",
      cargusUsername:        get("cargusUsername") || "",
      cargusEnabled:         get("cargusEnabled") === "true",
      glsUsername:     get("glsUsername") || "",
      glsClientNumber: get("glsClientNumber") || "",
      glsShipItUrl:    get("glsShipItUrl") || "",
      glsEnabled:      get("glsEnabled") === "true",
      glsSandbox:      get("glsSandbox") === "true",
      packetaEnabled: get("packetaEnabled") === "true",
      xconnectorEnabled: get("xconnectorEnabled") === "true",
      defaultCourier:  get("defaultCourier") || "fan",
      defaultWeight:   parseFloat(get("defaultWeight")) || 1,
      autoGenerateAwb: get("autoGenerateAwb") === "true",
      showPickupMap:   get("showPickupMap") === "true",
      widgetLanguage:  get("widgetLanguage") || "auto",
      fanHomeDeliveryFee:      parseFloat(get("fanHomeDeliveryFee"))      || 0,
      fanPickupFee:            parseFloat(get("fanPickupFee"))            || 0,
      samedayHomeDeliveryFee:  parseFloat(get("samedayHomeDeliveryFee"))  || 0,
      samedayPickupFee:        parseFloat(get("samedayPickupFee"))        || 0,
      cargusHomeDeliveryFee:   parseFloat(get("cargusHomeDeliveryFee"))   || 0,
      cargusPickupFee:         parseFloat(get("cargusPickupFee"))         || 0,
      glsHomeDeliveryFee:      parseFloat(get("glsHomeDeliveryFee"))      || 0,
      glsPickupFee:            parseFloat(get("glsPickupFee"))            || 0,
      packetaHomeDeliveryFee:  parseFloat(get("packetaHomeDeliveryFee"))  || 0,
      packetaPickupFee:        parseFloat(get("packetaPickupFee"))        || 0,
    };
    const fanPw = get("fanPassword");
    if (fanPw) data.fanPassword = fanPw;
    const samedayPw = get("samedayPassword");
    if (samedayPw) data.samedayPassword = samedayPw;
    const cargusPw = get("cargusPassword");
    if (cargusPw) data.cargusPassword = cargusPw;
    const glsPw = get("glsPassword");
    if (glsPw) data.glsPassword = glsPw;
    const packetaKey = get("packetaApiKey");
    if (packetaKey) data.packetaApiKey = packetaKey;
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
  const [samedaySandbox,  setSamedaySandbox]  = useState(!!settings.samedaySandbox);
  const [samedayUsername, setSamedayUsername] = useState(settings.samedayUsername || "");
  const [samedayPassword, setSamedayPassword] = useState("");

  const [cargusEnabled,         setCargusEnabled]         = useState(!!settings.cargusEnabled);
  const [cargusSubscriptionKey, setCargusSubscriptionKey] = useState(settings.cargusSubscriptionKey || "");
  const [cargusUsername,        setCargusUsername]        = useState(settings.cargusUsername || "");
  const [cargusPassword,        setCargusPassword]        = useState("");

  const [glsEnabled,      setGlsEnabled]      = useState(!!settings.glsEnabled);
  const [glsSandbox,      setGlsSandbox]      = useState(!!settings.glsSandbox);
  const [glsClientNumber, setGlsClientNumber] = useState(settings.glsClientNumber || "");
  const [glsUsername,     setGlsUsername]     = useState(settings.glsUsername || "");
  const [glsPassword,     setGlsPassword]     = useState("");
  const [glsShipItUrl,    setGlsShipItUrl]    = useState(settings.glsShipItUrl || "");

  const [packetaEnabled, setPacketaEnabled] = useState(!!settings.packetaEnabled);
  const [packetaApiKey,  setPacketaApiKey]  = useState("");

  const [xconnectorEnabled, setXconnectorEnabled] = useState(!!settings.xconnectorEnabled);
  const [xconnectorApiKey,  setXconnectorApiKey]  = useState("");

  const [defaultCourier,  setDefaultCourier]  = useState(settings.defaultCourier  || "fan");
  const [defaultWeight,   setDefaultWeight]   = useState(String(settings.defaultWeight || 1));
  const [showPickupMap,   setShowPickupMap]   = useState(settings.showPickupMap !== false);
  const [autoGenerateAwb, setAutoGenerateAwb] = useState(!!settings.autoGenerateAwb);
  const [widgetLanguage,  setWidgetLanguage]  = useState(settings.widgetLanguage  || "auto");

  const [fanHomeDeliveryFee,     setFanHomeDeliveryFee]     = useState(String(settings.fanHomeDeliveryFee     ?? 0));
  const [fanPickupFee,           setFanPickupFee]           = useState(String(settings.fanPickupFee           ?? 0));
  const [samedayHomeDeliveryFee, setSamedayHomeDeliveryFee] = useState(String(settings.samedayHomeDeliveryFee ?? 0));
  const [samedayPickupFee,       setSamedayPickupFee]       = useState(String(settings.samedayPickupFee       ?? 0));
  const [cargusHomeDeliveryFee,  setCargusHomeDeliveryFee]  = useState(String(settings.cargusHomeDeliveryFee  ?? 0));
  const [cargusPickupFee,        setCargusPickupFee]        = useState(String(settings.cargusPickupFee        ?? 0));
  const [glsHomeDeliveryFee,     setGlsHomeDeliveryFee]     = useState(String(settings.glsHomeDeliveryFee     ?? 0));
  const [glsPickupFee,           setGlsPickupFee]           = useState(String(settings.glsPickupFee           ?? 0));
  const [packetaHomeDeliveryFee, setPacketaHomeDeliveryFee] = useState(String(settings.packetaHomeDeliveryFee ?? 0));
  const [packetaPickupFee,       setPacketaPickupFee]       = useState(String(settings.packetaPickupFee       ?? 0));

  const [carrierStatus, setCarrierStatus] = useState(null); // null | "loading" | "registered" | "error"
  const [carrierMsg,    setCarrierMsg]    = useState("");

  const { t } = useTranslation();

  // ── Toasts ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (actionData?.saved) setToast(`✅ ${t("save_settings")}!`);
    else if (actionData?.testResult?.success) setToast(`✅ ${t("conn_success")}`);
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
      if (r.errors?.length) {
        setToast(`⚠️ Erori: ${r.errors.join(", ")}`);
      } else {
        const parts = [];
        if (r.fan)     parts.push(`${r.fan} FANbox`);
        if (r.sameday) parts.push(`${r.sameday} Sameday`);
        if (r.cargus)  parts.push(`${r.cargus} Cargus`);
        if (r.gls)     parts.push(`${r.gls} GLS`);
        if (r.packeta) parts.push(`${r.packeta} Packeta`);
        setToast(`✅ ${parts.join(" + ") || "0"} puncte reîmprospătate`);
      }
    }
  }, [actionData, t]);

  // ── Save handler ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const data = {
      intent: "save",
      senderName, senderCounty, senderCity, senderZip, senderAddress, senderPhone, senderEmail,
      fanEnabled: String(fanEnabled), fanClientId, fanUsername,
      samedayEnabled: String(samedayEnabled), samedaySandbox: String(samedaySandbox), samedayUsername,
      cargusEnabled: String(cargusEnabled), cargusSubscriptionKey, cargusUsername,
      glsEnabled: String(glsEnabled), glsSandbox: String(glsSandbox),
      glsClientNumber, glsUsername, glsShipItUrl,
      packetaEnabled: String(packetaEnabled),
      xconnectorEnabled: String(xconnectorEnabled),
      defaultCourier, defaultWeight,
      showPickupMap: String(showPickupMap),
      autoGenerateAwb: String(autoGenerateAwb),
      widgetLanguage,
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee,
      cargusHomeDeliveryFee, cargusPickupFee, glsHomeDeliveryFee, glsPickupFee,
      packetaHomeDeliveryFee, packetaPickupFee,
    };
    if (fanPassword) data.fanPassword = fanPassword;
    if (samedayPassword) data.samedayPassword = samedayPassword;
    if (cargusPassword) data.cargusPassword = cargusPassword;
    if (glsPassword) data.glsPassword = glsPassword;
    if (packetaApiKey) data.packetaApiKey = packetaApiKey;
    if (xconnectorApiKey) data.xconnectorApiKey = xconnectorApiKey;
    submit(data, { method: "post" });
  }, [senderName, senderCounty, senderCity, senderZip, senderAddress, senderPhone, senderEmail,
      fanEnabled, fanClientId, fanUsername, fanPassword,
      samedayEnabled, samedayUsername, samedayPassword, samedaySandbox,
      cargusEnabled, cargusSubscriptionKey, cargusUsername, cargusPassword,
      glsEnabled, glsClientNumber, glsUsername, glsPassword, glsSandbox, glsShipItUrl,
      packetaEnabled, packetaApiKey,
      xconnectorEnabled, xconnectorApiKey, defaultCourier, defaultWeight,
      showPickupMap, autoGenerateAwb, widgetLanguage,
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee,
      cargusHomeDeliveryFee, cargusPickupFee, glsHomeDeliveryFee, glsPickupFee,
      packetaHomeDeliveryFee, packetaPickupFee, submit]);

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
    { id: "sender",     content: `📦 ${t("tab_sender")}`     },
    { id: "fan",        content: "🚛 FAN Courier"              },
    { id: "sameday",    content: "📬 Sameday"                  },
    { id: "cargus",     content: "🚚 Cargus"                   },
    { id: "gls",        content: "🟡 GLS"                      },
    { id: "packeta",    content: "📮 Packeta"                   },
    { id: "xconnector", content: "🔗 xConnector"               },
    { id: "widget",     content: `🛒 ${t("tab_widget")}`       },
  ];

  return (
    <Frame>
      <Page title={t("settings_page_title")} subtitle={shop}>
        <Layout>
          <Layout.Section>
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
              <Box paddingBlockStart="400">

                {/* ── TAB 0: Expeditor ──────────────────────────────────── */}
                {tab === 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" fontWeight="semibold">{t("sender_title")}</Text>
                        <div>
                          <Text variant="bodySm" tone="subdued" as="span">{t("language_label")}&nbsp;&nbsp;</Text>
                          <LanguageSwitcher />
                        </div>
                      </InlineStack>
                      <Text tone="subdued">{t("sender_desc")}</Text>
                      <Divider />
                      <FormLayout>
                        <TextField label={t("s_company")} value={senderName} onChange={setSenderName} autoComplete="off" />
                        <FormLayout.Group>
                          <TextField label={t("s_county")} value={senderCounty} onChange={setSenderCounty} placeholder="ex: Constanta" autoComplete="off" />
                          <TextField label={t("s_city")} value={senderCity} onChange={setSenderCity} placeholder="ex: Constanta" autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label={t("s_zip")} value={senderZip} onChange={setSenderZip} placeholder="ex: 900205" autoComplete="off" />
                          <TextField label={t("s_address")} value={senderAddress} onChange={setSenderAddress} placeholder="ex: Str. Poporului 76" autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label={t("s_phone")} value={senderPhone} onChange={setSenderPhone} placeholder="+40..." autoComplete="off" />
                          <TextField label={t("s_email")} value={senderEmail} onChange={setSenderEmail} type="email" autoComplete="off" />
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
                          {fanEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("fan_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("fan_step1")}</Text>
                            <Text>2. {t("fan_step2")}</Text>
                            <Text>3. {t("fan_step3")}</Text>
                            <Text>4. {t("fan_step4")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("fan_enable")} checked={fanEnabled} onChange={setFanEnabled} />
                          <TextField label={t("fan_client_id")} value={fanClientId} onChange={setFanClientId} placeholder="ex: 7032158" helpText={t("fan_client_id_help")} autoComplete="off" />
                          <FormLayout.Group>
                            <TextField label={t("fan_username")} value={fanUsername} onChange={setFanUsername} autoComplete="off" />
                            <TextField label={t("fan_password")} value={fanPassword} onChange={setFanPassword} type="password" placeholder={t("pw_placeholder")} autoComplete="new-password" />
                          </FormLayout.Group>
                        </FormLayout>
                        {actionData?.testResult?.courier === "fan" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingSm" fontWeight="semibold">{t("fan_sandbox_title")}</Text>
                        <Text variant="bodySm" tone="subdued">{t("fan_sandbox_data")}</Text>
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
                          {samedayEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("sameday_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("sameday_step1")}</Text>
                            <Text>2. {t("sameday_step2")}</Text>
                            <Text>3. {t("sameday_step3")}</Text>
                            <Text>4. {t("sameday_step4")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("sameday_enable")} checked={samedayEnabled} onChange={setSamedayEnabled} />
                          <Checkbox
                            label={t("sandbox_label")}
                            checked={samedaySandbox}
                            onChange={setSamedaySandbox}
                            helpText={samedaySandbox ? t("sameday_sandbox_on") : t("sameday_sandbox_off")}
                          />
                          <FormLayout.Group>
                            <TextField label={t("sameday_username")} value={samedayUsername} onChange={setSamedayUsername} autoComplete="off" />
                            <TextField label={t("sameday_password")} value={samedayPassword} onChange={setSamedayPassword} type="password" placeholder={t("pw_placeholder")} autoComplete="new-password" />
                          </FormLayout.Group>
                        </FormLayout>
                        {actionData?.testResult?.courier === "sameday" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 3: Cargus ─────────────────────────────────────── */}
                {tab === 3 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">Cargus Urgent — API V3</Text>
                          {cargusEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("cargus_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("cargus_step1")}</Text>
                            <Text>2. {t("cargus_step2")}</Text>
                            <Text>3. {t("cargus_step3")}</Text>
                            <Text>4. {t("cargus_step4")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("cargus_enable")} checked={cargusEnabled} onChange={setCargusEnabled} />
                          <TextField
                            label={t("cargus_sub_key")}
                            value={cargusSubscriptionKey}
                            onChange={setCargusSubscriptionKey}
                            placeholder="ex: 1a2b3c4d5e6f..."
                            helpText={t("cargus_sub_key_help")}
                            autoComplete="off"
                          />
                          <FormLayout.Group>
                            <TextField label={t("cargus_username")} value={cargusUsername} onChange={setCargusUsername} autoComplete="off" />
                            <TextField label={t("cargus_password")} value={cargusPassword} onChange={setCargusPassword} type="password" placeholder={t("pw_placeholder")} autoComplete="new-password" />
                          </FormLayout.Group>
                        </FormLayout>
                        {actionData?.testResult?.courier === "cargus" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 4: GLS ────────────────────────────────────────── */}
                {tab === 4 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">GLS Romania — MyGLS API</Text>
                          {glsEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("gls_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("gls_step1")}</Text>
                            <Text>2. {t("gls_step2")}</Text>
                            <Text>3. {t("gls_step3")}</Text>
                            <Text>4. {t("gls_step4")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("gls_enable")} checked={glsEnabled} onChange={setGlsEnabled} />
                          <Checkbox
                            label={t("sandbox_label")}
                            checked={glsSandbox}
                            onChange={setGlsSandbox}
                            helpText={glsSandbox ? t("gls_sandbox_on") : t("gls_sandbox_off")}
                          />
                          <TextField
                            label={t("gls_client_number")}
                            value={glsClientNumber}
                            onChange={setGlsClientNumber}
                            placeholder="ex: 12345"
                            helpText={t("gls_client_number_help")}
                            autoComplete="off"
                          />
                          <FormLayout.Group>
                            <TextField label={t("gls_username")} value={glsUsername} onChange={setGlsUsername} autoComplete="off" />
                            <TextField label={t("gls_password")} value={glsPassword} onChange={setGlsPassword} type="password" placeholder={t("pw_placeholder")} autoComplete="new-password" />
                          </FormLayout.Group>
                          <TextField
                            label={t("gls_shipit_url")}
                            value={glsShipItUrl}
                            onChange={setGlsShipItUrl}
                            placeholder="ex: https://shipit.gls-group.eu/backend/rs/parcelshop"
                            helpText={t("gls_shipit_help")}
                            autoComplete="off"
                          />
                        </FormLayout>
                        {actionData?.testResult?.courier === "gls" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 5: Packeta ────────────────────────────────────── */}
                {tab === 5 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">Packeta (Zásilkovna) — REST API</Text>
                          {packetaEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("packeta_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("packeta_step1")}</Text>
                            <Text>2. {t("packeta_step2")}</Text>
                            <Text>3. {t("packeta_step3")}</Text>
                            <Text>4. {t("packeta_step4")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("packeta_enable")} checked={packetaEnabled} onChange={setPacketaEnabled} />
                          <TextField
                            label={t("packeta_api_key")}
                            value={packetaApiKey}
                            onChange={setPacketaApiKey}
                            type="password"
                            placeholder={t("packeta_api_key_ph")}
                            helpText={t("packeta_api_key_help")}
                            autoComplete="new-password"
                          />
                        </FormLayout>
                        {actionData?.testResult?.courier === "packeta" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 6: xConnector ─────────────────────────────────── */}
                {tab === 6 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("xconn_title")}</Text>
                        <Banner tone="info" title={t("xconn_how_title")}>
                          <BlockStack gap="200">
                            <Text>{t("xconn_info1")}</Text>
                            <Text>{t("xconn_info2")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("xconn_enable")} checked={xconnectorEnabled} onChange={setXconnectorEnabled} />
                          <TextField label={t("xconn_api_key")} value={xconnectorApiKey} onChange={setXconnectorApiKey} type="password" placeholder={t("xconn_api_key_ph")} helpText={t("xconn_api_key_help")} autoComplete="new-password" />
                        </FormLayout>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 7: Widget ─────────────────────────────────────── */}
                {tab === 7 && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("widget_title")}</Text>
                        <Divider />
                        <FormLayout>
                          <Select
                            label={t("default_courier_label")}
                            value={defaultCourier}
                            onChange={setDefaultCourier}
                            options={[
                              { label: "FAN Courier", value: "fan" },
                              { label: "Sameday",     value: "sameday" },
                              { label: "Cargus",      value: "cargus" },
                              { label: "GLS",         value: "gls" },
                              { label: "Packeta",     value: "packeta" },
                            ]}
                            helpText={t("default_courier_help")}
                          />
                          <TextField
                            label={t("default_weight_label")}
                            value={defaultWeight}
                            onChange={setDefaultWeight}
                            type="number"
                            min="0.1"
                            step="0.1"
                            suffix="kg"
                            helpText={t("default_weight_help")}
                            autoComplete="off"
                          />
                          <Select
                            label={t("widget_lang_label")}
                            value={widgetLanguage}
                            onChange={setWidgetLanguage}
                            helpText={t("widget_lang_help")}
                            options={[
                              { label: t("widget_lang_auto"), value: "auto" },
                              { label: "Română",   value: "ro" },
                              { label: "English",  value: "en" },
                              { label: "Deutsch",  value: "de" },
                              { label: "Magyar",   value: "hu" },
                              { label: "Čeština",  value: "cs" },
                            ]}
                          />
                          <Checkbox label={t("show_map_label")} checked={showPickupMap} onChange={setShowPickupMap} />
                          <Checkbox label={t("auto_awb_label")} checked={autoGenerateAwb} onChange={setAutoGenerateAwb} helpText={t("auto_awb_help")} />
                        </FormLayout>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("cache_title")}</Text>
                        <Text tone="subdued">{t("cache_desc")}</Text>
                        {actionData?.refreshResult && (
                          <Banner tone={actionData.refreshResult.errors?.length ? "warning" : "success"} title={t("cache_result_title")}>
                            <Text>FAN: {actionData.refreshResult.fan || 0} | Sameday: {actionData.refreshResult.sameday || 0} | Cargus: {actionData.refreshResult.cargus || 0} | GLS: {actionData.refreshResult.gls || 0} | Packeta: {actionData.refreshResult.packeta || 0}</Text>
                          </Banner>
                        )}
                        <Button onClick={handleRefresh} loading={saving}>{t("cache_refresh")}</Button>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("fees_title")}</Text>
                        <Banner tone="info" title={t("fees_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("fees_step1")}</Text>
                            <Text>2. {t("fees_step2")}</Text>
                            <Text>3. {t("fees_step3")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <FormLayout.Group>
                            <TextField label={t("fee_fan_home")} value={fanHomeDeliveryFee} onChange={setFanHomeDeliveryFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_fan_pickup")} value={fanPickupFee} onChange={setFanPickupFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_sameday_home")} value={samedayHomeDeliveryFee} onChange={setSamedayHomeDeliveryFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_sameday_pickup")} value={samedayPickupFee} onChange={setSamedayPickupFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_cargus_home")} value={cargusHomeDeliveryFee} onChange={setCargusHomeDeliveryFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_cargus_pickup")} value={cargusPickupFee} onChange={setCargusPickupFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_gls_home")} value={glsHomeDeliveryFee} onChange={setGlsHomeDeliveryFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_gls_pickup")} value={glsPickupFee} onChange={setGlsPickupFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_packeta_home")} value={packetaHomeDeliveryFee} onChange={setPacketaHomeDeliveryFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_packeta_pickup")} value={packetaPickupFee} onChange={setPacketaPickupFee} type="number" min="0" step="0.5" suffix="RON" helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                        </FormLayout>
                        <Banner tone="warning" title={t("fees_note_title")}>
                          <Text>{t("fees_note")}</Text>
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
                  {t("save_settings")}
                </Button>
                {tab === 1 && (
                  <Button onClick={() => handleTest("fan")} loading={saving}>
                    🔌 {t("test_connection")} FAN
                  </Button>
                )}
                {tab === 2 && (
                  <Button onClick={() => handleTest("sameday")} loading={saving}>
                    🔌 {t("test_connection")} Sameday
                  </Button>
                )}
                {tab === 3 && (
                  <Button onClick={() => handleTest("cargus")} loading={saving}>
                    🔌 {t("test_connection")} Cargus
                  </Button>
                )}
                {tab === 4 && (
                  <Button onClick={() => handleTest("gls")} loading={saving}>
                    🔌 {t("test_connection")} GLS
                  </Button>
                )}
                {tab === 5 && (
                  <Button onClick={() => handleTest("packeta")} loading={saving}>
                    🔌 {t("test_connection")} Packeta
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
