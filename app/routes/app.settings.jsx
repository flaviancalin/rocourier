// app/routes/app.settings.jsx
import { setupCheckout, resyncManualRatesIfNeeded } from "../services/checkout-setup.server.js";
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanAuthenticate } from "../services/fan-courier.server.js";
import { samedayAuthenticate } from "../services/sameday.server.js";
import { cargusAuthenticate } from "../services/cargus.server.js";
import { glsTestConnection } from "../services/gls.server.js";
import { packetaTestConnection, packetaCredentials } from "../services/packeta.server.js";
import { smartbillTestConnection } from "../services/smartbill.server.js";
import { oblioTestConnection } from "../services/oblio.server.js";
import { dpdTestConnection, dpdGetServices } from "../services/dpd.server.js";
import { fgoTestConnection } from "../services/fgo.server.js";
import { syncCodGuard } from "../services/cod-guard.server.js";
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
  const { session, admin } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
  });
  // Fees are stored in the shop's main currency
  let currency = "RON";
  try {
    const res = await admin.graphql(`{ shop { currencyCode } }`);
    currency = (await res.json()).data?.shop?.currencyCode || currency;
  } catch (_) {}
  // DPD contract services and pickup addresses, so the merchant picks from real values
  let dpd = null;
  if (settings?.dpdUsername && settings?.dpdPassword) {
    try {
      const [services, conn] = await Promise.all([
        dpdGetServices({ username: settings.dpdUsername, password: settings.dpdPassword }),
        dpdTestConnection({ username: settings.dpdUsername, password: settings.dpdPassword }),
      ]);
      dpd = { services, clients: conn.clients };
    } catch (e) {
      dpd = { error: e.message };
    }
  }
  // Never send stored secrets to the browser
  const {
    dpdPassword, fgoPrivateKey, fanPassword, samedayPassword, cargusPassword, glsPassword,
    packetaApiKey, packetaApiPassword, smartbillToken, oblioSecret, xconnectorApiKey, fanToken, samedayToken, ...safe
  } = settings || {};
  return json({ settings: { ...safe, hasDpdPassword: !!dpdPassword, hasFgoKey: !!fgoPrivateKey,
    ...(() => { const c = packetaCredentials({ packetaApiKey, packetaApiPassword }); return { hasPacketaKey: !!c.apiKey, hasPacketaPassword: !!c.apiPassword }; })() }, shop: session.shop, currency, dpd });
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
      await packetaTestConnection(packetaCredentials(settings));
      return json({ testResult: { courier: "packeta", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "packeta", success: false, error: e.message } });
    }
  }

  if (intent === "test-smartbill") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await smartbillTestConnection({ email: settings.smartbillEmail, token: settings.smartbillToken, cif: settings.smartbillCompanyCIF });
      return json({ testResult: { courier: "smartbill", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "smartbill", success: false, error: e.message } });
    }
  }

  if (intent === "test-oblio") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await oblioTestConnection({ email: settings.oblioEmail, secret: settings.oblioSecret, cif: settings.oblioCIF });
      return json({ testResult: { courier: "oblio", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "oblio", success: false, error: e.message } });
    }
  }

  if (intent === "test-dpd") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      const r = await dpdTestConnection({ username: settings.dpdUsername, password: settings.dpdPassword });
      return json({ testResult: { courier: "dpd", success: true, detail: r.clients.map((c) => c.name).join("; ") } });
    } catch (e) {
      return json({ testResult: { courier: "dpd", success: false, error: e.message } });
    }
  }

  if (intent === "test-fgo") {
    const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    try {
      await fgoTestConnection({ cui: String(settings.fgoCui || "").replace(/^RO/i, "").trim(), privateKey: settings.fgoPrivateKey, sandbox: !!settings.fgoSandbox });
      return json({ testResult: { courier: "fgo", success: true } });
    } catch (e) {
      return json({ testResult: { courier: "fgo", success: false, error: e.message } });
    }
  }

  if (intent === "carrier-register") {
    // Detects carrier-calculated shipping and puts Picklo's options into checkout:
    // CCS → nearest lockers as live rates · no CCS → fixed rates from Picklo's fees
    try {
      const r = await setupCheckout(admin, session.shop);
      return json({ carrierResult: { success: true, ...r } });
    } catch (e) {
      return json({ carrierResult: { success: false, error: e.message } });
    }
  }

  if (intent === "refresh-pickup-points") {
    try {
      const result = await refreshPickupPointsCache();
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
      glsEnabled:      get("glsEnabled") === "true",
      glsSandbox:      get("glsSandbox") === "true",
      packetaEnabled:     get("packetaEnabled") === "true",
      packetaLabelFormat: get("packetaLabelFormat") || "A6 on A4",
      packetaSender:      (get("packetaSender") || "").trim() || null,
      packetaHomeCarrierId: (get("packetaHomeCarrierId") || "").replace(/\D/g, "") || null,
      dpdUsername:   get("dpdUsername") || "",
      dpdEnabled:    get("dpdEnabled") === "true",
      dpdServiceId:  get("dpdServiceId") || null,
      dpdClientId:   get("dpdClientId") || null,
      dpdLabelSize:  get("dpdLabelSize") || "A6",
      fgoCui:        (get("fgoCui") || "").trim(),
      fgoSeries:     get("fgoSeries") || "",
      fgoTVA:        get("fgoTVA") || "21",
      fgoCurrency:   get("fgoCurrency") || "RON",
      fgoEnabled:    get("fgoEnabled") === "true",
      fgoSandbox:    get("fgoSandbox") === "true",
      freeShippingThreshold: parseFloat(get("freeShippingThreshold")) > 0 ? parseFloat(get("freeShippingThreshold")) : null,
      freeShippingScope:     get("freeShippingScope") === "pickup" ? "pickup" : "all",
      showDeliveryEstimate:  get("showDeliveryEstimate") === "true",
      dispatchCutoffHour:    Math.min(23, Math.max(0, parseInt(get("dispatchCutoffHour"), 10) || 14)),
      processingDays:        Math.min(10, Math.max(0, parseInt(get("processingDays"), 10) || 0)),
      validateAddresses:     get("validateAddresses") === "true",
      refusalWarnThreshold:  Math.max(0, parseInt(get("refusalWarnThreshold"), 10) || 0),
      blockCodAfterRefusals: Math.max(0, parseInt(get("blockCodAfterRefusals"), 10) || 0),
      returnsEnabled:        get("returnsEnabled") === "true",
      returnsWindowDays:     Math.min(90, Math.max(1, parseInt(get("returnsWindowDays"), 10) || 14)),
      returnsCourier:        get("returnsCourier") || null,
      returnsInstructions:   get("returnsInstructions") || null,
      xconnectorEnabled: get("xconnectorEnabled") === "true",
      smartbillEmail:      get("smartbillEmail")      || "",
      smartbillCompanyCIF: get("smartbillCompanyCIF") || "",
      smartbillSeries:     get("smartbillSeries")     || "",
      smartbillTVA:        get("smartbillTVA")        || "21",
      smartbillCurrency:   get("smartbillCurrency")   || "RON",
      smartbillEnabled:    get("smartbillEnabled") === "true",
      oblioEmail:    get("oblioEmail")    || "",
      oblioCIF:      get("oblioCIF")      || "",
      oblioSeries:   get("oblioSeries")   || "",
      oblioTVA:      get("oblioTVA")      || "21",
      oblioCurrency: get("oblioCurrency") || "RON",
      oblioEnabled:  get("oblioEnabled") === "true",
      invoiceProvider:      get("invoiceProvider")      || null,
      autoSendInvoice:      get("autoSendInvoice")      === "true",
      autoInvoiceOnFulfill: get("autoInvoiceOnFulfill") === "true",
      defaultCourier:  get("defaultCourier") || "fan",
      defaultWeight:   parseFloat(get("defaultWeight")) || 1,
      autoGenerateAwb: get("autoGenerateAwb") === "true",
      autoAwbMarkShipped: get("autoAwbMarkShipped") === "true",
      autoAwbNotifyCustomer: get("autoAwbNotifyCustomer") === "true",
      autoInvoiceOnDelivered: get("autoInvoiceOnDelivered") === "true",
      onCancelDeleteAwb: get("onCancelDeleteAwb") === "true",
      onRefundReverseInvoice: get("onRefundReverseInvoice") === "true",
      onDeliveredMarkPaid: get("onDeliveredMarkPaid") === "true",
      onReturnedCancelOrder: get("onReturnedCancelOrder") === "true",
      statusTags: get("statusTags") === "true",
      copyCustomerPhone: get("copyCustomerPhone") === "true",
      autoAwbFilter: get("autoAwbFilter") || "all",
      onCancelInvoice: get("onCancelInvoice") || "none",
      onReturnedInvoice: get("onReturnedInvoice") || "none",
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
      dpdHomeDeliveryFee:      parseFloat(get("dpdHomeDeliveryFee"))      || 0,
      dpdPickupFee:            parseFloat(get("dpdPickupFee"))            || 0,
      checkoutLockerCount:     Math.min(10, Math.max(1, parseInt(get("checkoutLockerCount"), 10) || 5)),
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
    if (packetaKey) data.packetaApiKey = packetaKey.trim();
    const packetaPw = get("packetaApiPassword");
    if (packetaPw) data.packetaApiPassword = packetaPw.trim();
    const xPw = get("xconnectorApiKey");
    if (xPw) data.xconnectorApiKey = xPw;
    const smartbillToken = get("smartbillToken");
    if (smartbillToken) data.smartbillToken = smartbillToken;
    const oblioSecret = get("oblioSecret");
    if (oblioSecret) data.oblioSecret = oblioSecret;
    const dpdPw = get("dpdPassword");
    if (dpdPw) data.dpdPassword = dpdPw;
    const fgoKey = get("fgoPrivateKey");
    if (fgoKey) data.fgoPrivateKey = fgoKey;
    // Routing rules arrive as JSON from the rules editor
    const rules = get("routingRules");
    if (rules != null) {
      try { data.routingRules = rules ? JSON.parse(rules) : null; } catch (_) { /* keep the stored rules */ }
    }

    const settingsBefore = await prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { blockCodAfterRefusals: true } });
    await prisma.shopSettings.upsert({
      where:  { shop: session.shop },
      update: data,
      create: { shop: session.shop, ...data },
    });
    // Stores without carrier-calculated shipping: keep the checkout rates priced like the dashboard
    let ratesSynced = null;
    try {
      ratesSynced = await resyncManualRatesIfNeeded(admin, session.shop);
    } catch (e) {
      console.error("[settings] rate resync failed:", e.message);
    }
    // Refusal protection: refresh the hidden-COD list (and turn the checkout rule on)
    let codGuard = null;
    if (data.blockCodAfterRefusals > 0 || settingsBefore?.blockCodAfterRefusals > 0) {
      try { codGuard = await syncCodGuard(session.shop, admin); }
      catch (e) {
        // admin.graphql throws a Response (not an Error) when Shopify refuses the call
        const msg = e?.message || (e?.status ? `Shopify a răspuns ${e.status}` : String(e));
        console.error("[settings] cod guard sync failed:", msg);
        codGuard = { error: msg };
      }
    }
    return json({ saved: true, ratesSynced: !!ratesSynced, codGuard });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Settings() {
  const { settings, shop, currency, dpd } = useLoaderData();
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

  const [packetaEnabled,     setPacketaEnabled]     = useState(!!settings.packetaEnabled);
  const [packetaApiKey,      setPacketaApiKey]      = useState("");
  const [packetaApiPassword, setPacketaApiPassword] = useState("");
  const [packetaSender,      setPacketaSender]      = useState(settings.packetaSender || "");
  const [packetaHomeCarrierId, setPacketaHomeCarrierId] = useState(settings.packetaHomeCarrierId || "");
  const [packetaLabelFormat, setPacketaLabelFormat] = useState(settings.packetaLabelFormat || "A6 on A4");

  const [dpdEnabled,   setDpdEnabled]   = useState(!!settings.dpdEnabled);
  const [dpdUsername,  setDpdUsername]  = useState(settings.dpdUsername || "");
  const [dpdPassword,  setDpdPassword]  = useState("");
  const [dpdServiceId, setDpdServiceId] = useState(settings.dpdServiceId || "");
  const [dpdClientId,  setDpdClientId]  = useState(settings.dpdClientId || "");
  const [dpdLabelSize, setDpdLabelSize] = useState(settings.dpdLabelSize || "A6");
  const [dpdHomeDeliveryFee, setDpdHomeDeliveryFee] = useState(String(settings.dpdHomeDeliveryFee ?? 0));
  const [dpdPickupFee,       setDpdPickupFee]       = useState(String(settings.dpdPickupFee ?? 0));

  const [fgoEnabled,    setFgoEnabled]    = useState(!!settings.fgoEnabled);
  const [fgoSandbox,    setFgoSandbox]    = useState(!!settings.fgoSandbox);
  const [fgoCui,        setFgoCui]        = useState(settings.fgoCui || "");
  const [fgoPrivateKey, setFgoPrivateKey] = useState("");
  const [fgoSeries,     setFgoSeries]     = useState(settings.fgoSeries || "");
  const [fgoTVA,        setFgoTVA]        = useState(settings.fgoTVA || "21");
  const [fgoCurrency,   setFgoCurrency]   = useState(settings.fgoCurrency || "RON");

  const [freeShippingThreshold, setFreeShippingThreshold] = useState(settings.freeShippingThreshold ? String(settings.freeShippingThreshold) : "");
  const [freeShippingScope,     setFreeShippingScope]     = useState(settings.freeShippingScope || "all");
  const [showDeliveryEstimate,  setShowDeliveryEstimate]  = useState(settings.showDeliveryEstimate !== false);
  const [dispatchCutoffHour,    setDispatchCutoffHour]    = useState(String(settings.dispatchCutoffHour ?? 14));
  const [processingDays,        setProcessingDays]        = useState(String(settings.processingDays ?? 0));
  const [validateAddresses,     setValidateAddresses]     = useState(settings.validateAddresses !== false);
  const [refusalWarnThreshold,  setRefusalWarnThreshold]  = useState(String(settings.refusalWarnThreshold ?? 1));
  const [blockCodAfterRefusals, setBlockCodAfterRefusals] = useState(String(settings.blockCodAfterRefusals ?? 0));
  const [returnsEnabled,        setReturnsEnabled]        = useState(!!settings.returnsEnabled);
  const [returnsWindowDays,     setReturnsWindowDays]     = useState(String(settings.returnsWindowDays ?? 14));
  const [returnsCourier,        setReturnsCourier]        = useState(settings.returnsCourier || "");
  const [returnsInstructions,   setReturnsInstructions]   = useState(settings.returnsInstructions || "");
  const [routingRules,          setRoutingRules]          = useState(Array.isArray(settings.routingRules) ? settings.routingRules : []);

  const [xconnectorEnabled, setXconnectorEnabled] = useState(!!settings.xconnectorEnabled);
  const [xconnectorApiKey,  setXconnectorApiKey]  = useState("");

  const [smartbillEnabled,    setSmartbillEnabled]    = useState(!!settings.smartbillEnabled);
  const [smartbillEmail,      setSmartbillEmail]      = useState(settings.smartbillEmail      || "");
  const [smartbillToken,      setSmartbillToken]      = useState("");
  const [smartbillCompanyCIF, setSmartbillCompanyCIF] = useState(settings.smartbillCompanyCIF || "");
  const [smartbillSeries,     setSmartbillSeries]     = useState(settings.smartbillSeries     || "");
  const [smartbillTVA,        setSmartbillTVA]        = useState(settings.smartbillTVA        || "21");
  const [smartbillCurrency,   setSmartbillCurrency]   = useState(settings.smartbillCurrency   || "RON");

  const [oblioEnabled,  setOblioEnabled]  = useState(!!settings.oblioEnabled);
  const [oblioEmail,    setOblioEmail]    = useState(settings.oblioEmail    || "");
  const [oblioSecret,   setOblioSecret]   = useState("");
  const [oblioCIF,      setOblioCIF]      = useState(settings.oblioCIF      || "");
  const [oblioSeries,   setOblioSeries]   = useState(settings.oblioSeries   || "");
  const [oblioTVA,      setOblioTVA]      = useState(settings.oblioTVA      || "21");
  const [oblioCurrency, setOblioCurrency] = useState(settings.oblioCurrency || "RON");

  const [invoiceProvider,      setInvoiceProvider]      = useState(settings.invoiceProvider      || "");
  const [autoSendInvoice,      setAutoSendInvoice]      = useState(!!settings.autoSendInvoice);
  const [autoInvoiceOnFulfill, setAutoInvoiceOnFulfill] = useState(!!settings.autoInvoiceOnFulfill);

  const [defaultCourier,  setDefaultCourier]  = useState(settings.defaultCourier  || "fan");
  const [defaultWeight,   setDefaultWeight]   = useState(String(settings.defaultWeight || 1));
  const [showPickupMap,   setShowPickupMap]   = useState(settings.showPickupMap !== false);
  const [autoGenerateAwb, setAutoGenerateAwb] = useState(!!settings.autoGenerateAwb);
  const [autoAwbMarkShipped, setAutoAwbMarkShipped] = useState(!!settings.autoAwbMarkShipped);
  const [autoAwbNotifyCustomer, setAutoAwbNotifyCustomer] = useState(!!settings.autoAwbNotifyCustomer);
  const [autoInvoiceOnDelivered, setAutoInvoiceOnDelivered] = useState(!!settings.autoInvoiceOnDelivered);
  const [onCancelDeleteAwb, setOnCancelDeleteAwb] = useState(!!settings.onCancelDeleteAwb);
  const [onRefundReverseInvoice, setOnRefundReverseInvoice] = useState(!!settings.onRefundReverseInvoice);
  const [onDeliveredMarkPaid, setOnDeliveredMarkPaid] = useState(!!settings.onDeliveredMarkPaid);
  const [onReturnedCancelOrder, setOnReturnedCancelOrder] = useState(!!settings.onReturnedCancelOrder);
  const [statusTags, setStatusTags] = useState(!!settings.statusTags);
  const [copyCustomerPhone, setCopyCustomerPhone] = useState(!!settings.copyCustomerPhone);
  const [autoAwbFilter, setAutoAwbFilter] = useState(settings.autoAwbFilter || "all");
  const [onCancelInvoice, setOnCancelInvoice] = useState(settings.onCancelInvoice || "none");
  const [onReturnedInvoice, setOnReturnedInvoice] = useState(settings.onReturnedInvoice || "none");
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
  const [checkoutMode,  setCheckoutMode]  = useState(settings.checkoutMode || null);
  const [lockerCount,   setLockerCount]   = useState(String(settings.checkoutLockerCount ?? 5));
  const [carrierMsg,    setCarrierMsg]    = useState("");

  const { t } = useTranslation();

  // ── Toasts ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (actionData?.saved && (actionData.codGuard?.error || actionData.codGuard?.customization?.error)) {
      setToast(`⚠️ ${t("save_settings")} — ${actionData.codGuard.error || actionData.codGuard.customization.error}`);
    }
    else if (actionData?.saved) setToast(`✅ ${t("save_settings")}!`);
    else if (actionData?.testResult?.success) setToast(`✅ ${t("conn_success")}`);
    else if (actionData?.testResult?.success === false) setToast(`❌ ${actionData.testResult.error}`);
    else if (actionData?.carrierResult) {
      const r = actionData.carrierResult;
      if (r.success) {
        setCarrierStatus("registered");
        setCheckoutMode(r.mode);
        setCarrierMsg((r.zones || []).join(", ") || "—");
      } else {
        setCarrierStatus("error");
        setCarrierMsg(r.error || t("carrier_service_error"));
      }
    }
    else if (actionData?.refreshResult) {
      const r = actionData.refreshResult;
      if (r.errors?.length) {
        setToast(`⚠️ ${t("error")}: ${r.errors.join(", ")}`);
      } else {
        const total = (r.fan || 0) + (r.sameday || 0) + (r.cargus || 0) + (r.gls || 0) + (r.packeta || 0) + (r.dpd || 0);
        setToast(`✅ ${t("carrier_pts_refreshed", { n: total })}`);
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
      glsClientNumber, glsUsername,
      packetaEnabled: String(packetaEnabled),
      packetaLabelFormat, packetaSender, packetaHomeCarrierId,
      dpdEnabled: String(dpdEnabled), dpdUsername, dpdServiceId, dpdClientId, dpdLabelSize,
      dpdHomeDeliveryFee, dpdPickupFee,
      fgoEnabled: String(fgoEnabled), fgoSandbox: String(fgoSandbox), fgoCui, fgoSeries, fgoTVA, fgoCurrency,
      freeShippingThreshold, freeShippingScope, showDeliveryEstimate: String(showDeliveryEstimate),
      dispatchCutoffHour, processingDays,
      validateAddresses: String(validateAddresses), refusalWarnThreshold, blockCodAfterRefusals,
      returnsEnabled: String(returnsEnabled), returnsWindowDays, returnsCourier, returnsInstructions,
      routingRules: JSON.stringify(routingRules.filter((rule) => rule.courier)),
      xconnectorEnabled: String(xconnectorEnabled),
      smartbillEnabled: String(smartbillEnabled), smartbillEmail, smartbillCompanyCIF, smartbillSeries, smartbillTVA, smartbillCurrency,
      oblioEnabled: String(oblioEnabled), oblioEmail, oblioCIF, oblioSeries, oblioTVA, oblioCurrency,
      invoiceProvider:      invoiceProvider || "",
      autoSendInvoice:      String(autoSendInvoice),
      autoInvoiceOnFulfill: String(autoInvoiceOnFulfill),
      defaultCourier, defaultWeight,
      showPickupMap: String(showPickupMap),
      autoGenerateAwb: String(autoGenerateAwb),
      autoAwbMarkShipped: String(autoAwbMarkShipped),
      autoAwbNotifyCustomer: String(autoAwbNotifyCustomer),
      autoInvoiceOnDelivered: String(autoInvoiceOnDelivered),
      onCancelDeleteAwb: String(onCancelDeleteAwb),
      onRefundReverseInvoice: String(onRefundReverseInvoice),
      onDeliveredMarkPaid: String(onDeliveredMarkPaid),
      onReturnedCancelOrder: String(onReturnedCancelOrder),
      statusTags: String(statusTags),
      copyCustomerPhone: String(copyCustomerPhone),
      autoAwbFilter,
      onCancelInvoice,
      onReturnedInvoice,
      widgetLanguage,
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee,
      cargusHomeDeliveryFee, cargusPickupFee, glsHomeDeliveryFee, glsPickupFee,
      packetaHomeDeliveryFee, packetaPickupFee,
      checkoutLockerCount: lockerCount,
    };
    if (fanPassword) data.fanPassword = fanPassword;
    if (samedayPassword) data.samedayPassword = samedayPassword;
    if (cargusPassword) data.cargusPassword = cargusPassword;
    if (glsPassword) data.glsPassword = glsPassword;
    if (packetaApiKey) data.packetaApiKey = packetaApiKey;
    if (packetaApiPassword) data.packetaApiPassword = packetaApiPassword;
    if (xconnectorApiKey) data.xconnectorApiKey = xconnectorApiKey;
    if (smartbillToken) data.smartbillToken = smartbillToken;
    if (oblioSecret)    data.oblioSecret    = oblioSecret;
    if (dpdPassword)    data.dpdPassword    = dpdPassword;
    if (fgoPrivateKey)  data.fgoPrivateKey  = fgoPrivateKey;
    submit(data, { method: "post" });
  }, [senderName, senderCounty, senderCity, senderZip, senderAddress, senderPhone, senderEmail,
      fanEnabled, fanClientId, fanUsername, fanPassword,
      samedayEnabled, samedayUsername, samedayPassword, samedaySandbox,
      cargusEnabled, cargusSubscriptionKey, cargusUsername, cargusPassword,
      glsEnabled, glsClientNumber, glsUsername, glsPassword, glsSandbox,
      packetaEnabled, packetaApiKey, packetaApiPassword, packetaSender, packetaHomeCarrierId, packetaLabelFormat,
      xconnectorEnabled, xconnectorApiKey, defaultCourier, defaultWeight,
      showPickupMap, autoGenerateAwb, widgetLanguage,
      autoAwbMarkShipped, autoAwbNotifyCustomer, autoInvoiceOnDelivered, onCancelDeleteAwb, onRefundReverseInvoice, onDeliveredMarkPaid, onReturnedCancelOrder, statusTags, copyCustomerPhone, autoAwbFilter, onCancelInvoice, onReturnedInvoice,
      fanHomeDeliveryFee, fanPickupFee, samedayHomeDeliveryFee, samedayPickupFee,
      cargusHomeDeliveryFee, cargusPickupFee, glsHomeDeliveryFee, glsPickupFee,
      packetaHomeDeliveryFee, packetaPickupFee, lockerCount,
      smartbillEnabled, smartbillEmail, smartbillToken, smartbillCompanyCIF, smartbillSeries, smartbillTVA, smartbillCurrency,
      oblioEnabled, oblioEmail, oblioSecret, oblioCIF, oblioSeries, oblioTVA, oblioCurrency,
      invoiceProvider, autoSendInvoice, autoInvoiceOnFulfill,
      dpdEnabled, dpdUsername, dpdPassword, dpdServiceId, dpdClientId, dpdLabelSize, dpdHomeDeliveryFee, dpdPickupFee,
      fgoEnabled, fgoSandbox, fgoCui, fgoPrivateKey, fgoSeries, fgoTVA, fgoCurrency,
      freeShippingThreshold, freeShippingScope, showDeliveryEstimate, dispatchCutoffHour, processingDays,
      validateAddresses, refusalWarnThreshold, blockCodAfterRefusals, returnsEnabled, returnsWindowDays, returnsCourier, returnsInstructions,
      routingRules, submit]);

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

  const invoiceActionOptions = [
    { label: t("auto_invoice_none"), value: "none" },
    { label: t("auto_invoice_cancel"), value: "cancel" },
    { label: t("auto_invoice_reverse"), value: "reverse" },
  ];

  // Related settings share a tab and are stacked as cards, so each tab stays short to scroll
  const tabs = [
    { id: "couriers",    content: `🚚 ${t("tab_couriers")}`,        sections: ["fan", "sameday", "cargus", "gls", "packeta", "dpd", "xconnector"] },
    { id: "sender",      content: `📦 ${t("tab_sender")}`,          sections: ["sender"] },
    { id: "widget",      content: `🛒 ${t("tab_widget")}`,          sections: ["widget"] },
    { id: "delivery",    content: `🛡️ ${t("tab_delivery_checks")}`, sections: ["delivery"] },
    { id: "facturare",   content: `🧾 ${t("tab_invoicing")}`,       sections: ["facturare"] },
    { id: "automations", content: `⚙️ ${t("tab_automations")}`,     sections: ["automations"] },
  ];
  const sections = tabs[tab]?.sections || [];
  const show = (id) => sections.includes(id);

  return (
    <Frame>
      <Page title={t("settings_page_title")} subtitle={shop}>
        <Layout>
          <Layout.Section>
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
              <Box paddingBlockStart="400"><BlockStack gap="600">

                {/* ── TAB 0: Expeditor ──────────────────────────────────── */}
                {show("sender") && (
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
                {show("fan") && (
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
                {show("sameday") && (
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
                {show("cargus") && (
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
                {show("gls") && (
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
                {show("packeta") && (
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
                          <FormLayout.Group>
                            <TextField label={t("packeta_key16")} value={packetaApiKey} onChange={setPacketaApiKey} type="password"
                              placeholder={settings.hasPacketaKey ? t("pw_placeholder") : "ex: ae827fd9b1c0412f"} helpText={t("packeta_key16_help")} autoComplete="new-password" />
                            <TextField label={t("packeta_pw32")} value={packetaApiPassword} onChange={setPacketaApiPassword} type="password"
                              placeholder={settings.hasPacketaPassword ? t("pw_placeholder") : ""} helpText={t("packeta_pw32_help")} autoComplete="new-password" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("packeta_sender")} value={packetaSender} onChange={setPacketaSender} helpText={t("packeta_sender_help")} autoComplete="off" />
                            <TextField label={t("packeta_home_carrier")} value={packetaHomeCarrierId} onChange={setPacketaHomeCarrierId} placeholder="4161" helpText={t("packeta_home_carrier_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <Select
                            label={t("packeta_label_format")}
                            value={packetaLabelFormat}
                            onChange={setPacketaLabelFormat}
                            options={[
                              { label: t("packeta_label_a6_a4"), value: "A6 on A4" },
                              { label: "A6 (10×15 cm) pe A6", value: "A6 on A6" },
                              { label: t("packeta_label_a7_a4"), value: "A7 on A4" },
                              { label: "A7 pe A7", value: "A7 on A7" },
                              { label: "A8 pe A8", value: "A8 on A8" },
                            ]}
                            helpText={t("packeta_label_help")}
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

                {/* ── DPD ──────────────────────────────────────────────────── */}
                {show("dpd") && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" fontWeight="semibold">DPD Romania — Web API</Text>
                          {dpdEnabled ? <Badge tone="success">{t("status_active")}</Badge> : <Badge tone="critical">{t("status_inactive")}</Badge>}
                        </InlineStack>
                        <Banner tone="info" title={t("dpd_how_title")}>
                          <BlockStack gap="100">
                            <Text>1. {t("dpd_step1")}</Text>
                            <Text>2. {t("dpd_step2")}</Text>
                            <Text>3. {t("dpd_step3")}</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Checkbox label={t("dpd_enable")} checked={dpdEnabled} onChange={setDpdEnabled} />
                          <FormLayout.Group>
                            <TextField label={t("dpd_username")} value={dpdUsername} onChange={setDpdUsername} autoComplete="off" />
                            <TextField label={t("dpd_password")} value={dpdPassword} onChange={setDpdPassword} type="password"
                              placeholder={settings.hasDpdPassword ? t("pw_placeholder") : ""} autoComplete="new-password" />
                          </FormLayout.Group>
                          {dpd?.error && <Banner tone="critical" title={t("conn_error")}><Text>{dpd.error}</Text></Banner>}
                          <Select
                            label={t("dpd_service")}
                            value={dpdServiceId}
                            onChange={setDpdServiceId}
                            options={[
                              { label: t("dpd_service_auto"), value: "" },
                              ...(dpd?.services || []).map((sv) => ({ label: `${sv.name} (${sv.id})`, value: String(sv.id) })),
                            ]}
                            helpText={dpd?.services ? t("dpd_service_help") : t("dpd_save_first")}
                          />
                          <Select
                            label={t("dpd_client")}
                            value={dpdClientId}
                            onChange={setDpdClientId}
                            options={[
                              { label: t("dpd_client_default"), value: "" },
                              ...(dpd?.clients || []).map((c) => ({ label: `${c.name}${c.address ? ` — ${c.address}` : ""}`, value: String(c.clientId) })),
                            ]}
                            helpText={t("dpd_client_help")}
                          />
                          <Select
                            label={t("dpd_label_size")}
                            value={dpdLabelSize}
                            onChange={setDpdLabelSize}
                            options={[
                              { label: "A6 (10×15 cm)", value: "A6" },
                              { label: "A4", value: "A4" },
                              { label: "A4 — 4 × A6", value: "A4_4xA6" },
                            ]}
                          />
                        </FormLayout>
                        {actionData?.testResult?.courier === "dpd" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                            {actionData.testResult.detail && <Text>{actionData.testResult.detail}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 6: xConnector ─────────────────────────────────── */}
                {show("xconnector") && (
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
                {show("widget") && (
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
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("checkout_setup_title")}</Text>
                        <Text tone="subdued">{t("checkout_setup_desc")}</Text>
                        {checkoutMode === "ccs" && (
                          <Banner tone="success">
                            <Text>{t("checkout_mode_ccs", { n: lockerCount, zones: carrierMsg || "—" })}</Text>
                          </Banner>
                        )}
                        {checkoutMode === "manual" && (
                          <Banner tone="info">
                            <Text>{t("checkout_mode_manual", { zones: carrierMsg || "—" })}</Text>
                          </Banner>
                        )}
                        {!checkoutMode && carrierStatus !== "error" && (
                          <Text tone="subdued">{t("checkout_mode_none")}</Text>
                        )}
                        {carrierStatus === "error" && (
                          <Banner tone="critical" title={t("carrier_service_error")}>
                            <Text>{carrierMsg}</Text>
                          </Banner>
                        )}
                        {checkoutMode === "ccs" && (
                          <TextField label={t("checkout_locker_count")} value={lockerCount} onChange={setLockerCount}
                            type="number" min="1" max="10" autoComplete="off" />
                        )}
                        <InlineStack gap="200">
                          <Button variant="primary" onClick={handleCarrierRegister} loading={carrierStatus === "loading"}>
                            {t("checkout_setup_btn")}
                          </Button>
                          {/* Checkout blocks must be placed once by the merchant in the checkout editor */}
                          <Button url={`https://${shop}/admin/settings/checkout/editor?page=thank-you&context=apps`} target="_top">
                            {t("thankyou_block_btn")}
                          </Button>
                        </InlineStack>
                        <Text tone="subdued" variant="bodySm">{t("thankyou_block_help")}</Text>
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
                            <TextField label={t("fee_fan_home")} value={fanHomeDeliveryFee} onChange={setFanHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_fan_pickup")} value={fanPickupFee} onChange={setFanPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_sameday_home")} value={samedayHomeDeliveryFee} onChange={setSamedayHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_sameday_pickup")} value={samedayPickupFee} onChange={setSamedayPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_cargus_home")} value={cargusHomeDeliveryFee} onChange={setCargusHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_cargus_pickup")} value={cargusPickupFee} onChange={setCargusPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_gls_home")} value={glsHomeDeliveryFee} onChange={setGlsHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_gls_pickup")} value={glsPickupFee} onChange={setGlsPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_packeta_home")} value={packetaHomeDeliveryFee} onChange={setPacketaHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_packeta_pickup")} value={packetaPickupFee} onChange={setPacketaPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label={t("fee_dpd_home")} value={dpdHomeDeliveryFee} onChange={setDpdHomeDeliveryFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                            <TextField label={t("fee_dpd_pickup")} value={dpdPickupFee} onChange={setDpdPickupFee} type="number" min="0" step="0.5" suffix={currency} helpText={t("fee_free_help")} autoComplete="off" />
                          </FormLayout.Group>
                        </FormLayout>
                        <Banner tone="warning" title={t("fees_note_title")}>
                          <Text>{t("fees_note", { currency })}</Text>
                        </Banner>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 9: Automatizări ───────────────────────────────── */}
                {show("automations") && (
                  <BlockStack gap="400">
                    <Banner tone="info">
                      <Text>{t("auto_intro")}</Text>
                    </Banner>

                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("auto_cancel_title")}</Text>
                        <Checkbox label={t("auto_cancel_awb")} helpText={t("auto_cancel_awb_help")} checked={onCancelDeleteAwb} onChange={setOnCancelDeleteAwb} />
                        <Select label={t("auto_cancel_invoice")} value={onCancelInvoice} onChange={setOnCancelInvoice} options={invoiceActionOptions} helpText={t("auto_invoice_action_help")} />
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("auto_delivery_title")}</Text>
                        <Checkbox label={t("auto_delivered_paid")} helpText={t("auto_delivered_paid_help")} checked={onDeliveredMarkPaid} onChange={setOnDeliveredMarkPaid} />
                        <Checkbox label={t("auto_returned_cancel")} helpText={t("auto_returned_cancel_help")} checked={onReturnedCancelOrder} onChange={setOnReturnedCancelOrder} />
                        <Select label={t("auto_returned_invoice")} value={onReturnedInvoice} onChange={setOnReturnedInvoice} options={invoiceActionOptions} />
                        <Checkbox label={t("auto_status_tags")} helpText={t("auto_status_tags_help")} checked={statusTags} onChange={setStatusTags} />
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("auto_invoice_title")}</Text>
                        <Text tone="subdued">{t("auto_invoice_need_provider")}</Text>
                        <Checkbox label={t("auto_invoice_create")} checked={autoSendInvoice} onChange={setAutoSendInvoice} />
                        <Checkbox label={t("auto_invoice_fulfill")} checked={autoInvoiceOnFulfill} onChange={setAutoInvoiceOnFulfill} />
                        <Checkbox label={t("auto_invoice_delivered")} helpText={t("auto_invoice_delivered_help")} checked={autoInvoiceOnDelivered} onChange={setAutoInvoiceOnDelivered} />
                        <Checkbox label={t("auto_refund_reverse")} checked={onRefundReverseInvoice} onChange={setOnRefundReverseInvoice} />
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingMd" fontWeight="semibold">{t("auto_awb_title")}</Text>
                        <Checkbox label={t("auto_awb_enable")} helpText={t("auto_awb_enable_help")} checked={autoGenerateAwb} onChange={setAutoGenerateAwb} />
                        {autoGenerateAwb && (
                          <BlockStack gap="300">
                            <Select label={t("auto_awb_filter")} value={autoAwbFilter} onChange={setAutoAwbFilter} options={[
                              { label: t("auto_awb_filter_all"), value: "all" },
                              { label: t("auto_awb_filter_cod"), value: "cod" },
                              { label: t("auto_awb_filter_paid"), value: "paid" },
                              { label: t("auto_awb_filter_pickup"), value: "pickup" },
                            ]} />
                            <Checkbox label={t("auto_awb_ship")} checked={autoAwbMarkShipped} onChange={setAutoAwbMarkShipped} />
                            <Checkbox label={t("auto_awb_notify")} disabled={!autoAwbMarkShipped} checked={autoAwbNotifyCustomer && autoAwbMarkShipped} onChange={setAutoAwbNotifyCustomer} />
                          </BlockStack>
                        )}
                        <Checkbox label={t("auto_copy_phone")} helpText={t("auto_copy_phone_help")} checked={copyCustomerPhone} onChange={setCopyCustomerPhone} />
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

                {/* ── TAB 8: Facturare ─────────────────────────────────── */}
                {show("facturare") && (
                  <BlockStack gap="400">

                    {/* Provider selector */}
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">Facturare automata</Text>
                        <Banner tone="info" title="Cum functioneaza?">
                          <BlockStack gap="100">
                            <Text>1. Alege furnizorul de facturare (SmartBill, Oblio sau FGO).</Text>
                            <Text>2. Introdu credentialele API si CIF-ul firmei.</Text>
                            <Text>3. Activeaza generarea automata la comanda noua sau la fulfillment.</Text>
                          </BlockStack>
                        </Banner>
                        <Divider />
                        <FormLayout>
                          <Select
                            label="Furnizor facturare activ"
                            value={invoiceProvider || ""}
                            onChange={setInvoiceProvider}
                            options={[
                              { label: "— Dezactivat —",   value: ""         },
                              { label: "SmartBill",         value: "smartbill" },
                              { label: "Oblio",             value: "oblio"     },
                              { label: "FGO",               value: "fgo"       },
                            ]}
                            helpText="Selecteaza furnizorul cu care doresti sa emiti facturile."
                          />
                          <Checkbox
                            label="Genereaza factura automat la comanda noua"
                            checked={autoSendInvoice}
                            onChange={setAutoSendInvoice}
                            helpText="Factura va fi emisa imediat dupa plasarea comenzii."
                          />
                          <Checkbox
                            label="Genereaza factura la fulfillment (expediere)"
                            checked={autoInvoiceOnFulfill}
                            onChange={setAutoInvoiceOnFulfill}
                            helpText="Factura va fi emisa cand comanda este marcata ca expediata."
                          />
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    {/* SmartBill config */}
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" fontWeight="semibold">SmartBill</Text>
                          <Checkbox label="Activat" checked={smartbillEnabled} onChange={setSmartbillEnabled} />
                        </InlineStack>
                        <Text tone="subdued">Obtine credentialele din app.smartbill.ro &rarr; Configurare &rarr; Tokenuri API</Text>
                        <Divider />
                        <FormLayout>
                          <TextField label="Email SmartBill" value={smartbillEmail} onChange={setSmartbillEmail} type="email" autoComplete="off" />
                          <TextField label="Token API" value={smartbillToken} onChange={setSmartbillToken} type="password" placeholder="Lasa gol pentru a pastra token-ul existent" autoComplete="new-password" />
                          <FormLayout.Group>
                            <TextField label="CIF firma (ex: RO12345678)" value={smartbillCompanyCIF} onChange={setSmartbillCompanyCIF} autoComplete="off" />
                            <TextField label="Serie factura (ex: FACT)" value={smartbillSeries} onChange={setSmartbillSeries} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label="TVA (%)" value={smartbillTVA} onChange={setSmartbillTVA} type="number" min="0" max="30" autoComplete="off" />
                            <Select
                              label="Moneda"
                              value={smartbillCurrency}
                              onChange={setSmartbillCurrency}
                              options={[
                                { label: "RON", value: "RON" },
                                { label: "EUR", value: "EUR" },
                                { label: "USD", value: "USD" },
                              ]}
                            />
                          </FormLayout.Group>
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    {/* Oblio config */}
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" fontWeight="semibold">Oblio</Text>
                          <Checkbox label="Activat" checked={oblioEnabled} onChange={setOblioEnabled} />
                        </InlineStack>
                        <Text tone="subdued">Obtine credentialele din app.oblio.eu &rarr; Setari &rarr; API</Text>
                        <Divider />
                        <FormLayout>
                          <TextField label="Email Oblio" value={oblioEmail} onChange={setOblioEmail} type="email" autoComplete="off" />
                          <TextField label="Client Secret" value={oblioSecret} onChange={setOblioSecret} type="password" placeholder="Lasa gol pentru a pastra secretul existent" autoComplete="new-password" />
                          <FormLayout.Group>
                            <TextField label="CIF firma (ex: RO12345678)" value={oblioCIF} onChange={setOblioCIF} autoComplete="off" />
                            <TextField label="Serie factura (ex: FCT)" value={oblioSeries} onChange={setOblioSeries} autoComplete="off" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label="TVA (%)" value={oblioTVA} onChange={setOblioTVA} type="number" min="0" max="30" autoComplete="off" />
                            <Select
                              label="Moneda"
                              value={oblioCurrency}
                              onChange={setOblioCurrency}
                              options={[
                                { label: "RON", value: "RON" },
                                { label: "EUR", value: "EUR" },
                                { label: "USD", value: "USD" },
                              ]}
                            />
                          </FormLayout.Group>
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    {/* FGO config */}
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" fontWeight="semibold">FGO</Text>
                          <Checkbox label="Activat" checked={fgoEnabled} onChange={setFgoEnabled} />
                        </InlineStack>
                        <BlockStack gap="100">
                          <Text tone="subdued">1. In FGO: Contul meu &rarr; Chei API &rarr; Genereaza cheie API (drepturi: facturi citire, emitere, anulare, incasare). Cheia se vede o singura data.</Text>
                          <Text tone="subdued">2. In FGO: Setari &rarr; eCommerce &rarr; Setari API &rarr; Domenii autorizate: adauga <Text as="span" fontWeight="semibold">{shop}</Text> si salveaza.</Text>
                          <Text tone="subdued">3. Seria trebuie sa existe in Setari &rarr; Serii/registre (registru de tip Facturi). In productie API-ul cere abonament Premium sau Enterprise.</Text>
                        </BlockStack>
                        <Divider />
                        <FormLayout>
                          <FormLayout.Group>
                            <TextField label="CUI firma (fara RO)" value={fgoCui} onChange={setFgoCui} autoComplete="off" />
                            <TextField label="Cheie API (fgo_api_v1…)" value={fgoPrivateKey} onChange={setFgoPrivateKey} type="password"
                              placeholder={settings.hasFgoKey ? "Lasa gol pentru a pastra cheia existenta" : ""} autoComplete="new-password" />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField label="Serie factura (ex: FCT)" value={fgoSeries} onChange={setFgoSeries} autoComplete="off" />
                            <TextField label="TVA (%)" value={fgoTVA} onChange={setFgoTVA} type="number" min="0" max="30" autoComplete="off" />
                            <Select
                              label="Moneda"
                              value={fgoCurrency}
                              onChange={setFgoCurrency}
                              options={[
                                { label: "RON", value: "RON" },
                                { label: "EUR", value: "EUR" },
                                { label: "USD", value: "USD" },
                              ]}
                            />
                          </FormLayout.Group>
                          <Checkbox label="Mediu de test FGO (api-testuat.fgo.ro)" checked={fgoSandbox} onChange={setFgoSandbox}
                            helpText="Pentru un cont creat pe testuat.fgo.ro. Facturile de test nu au valoare fiscala." />
                        </FormLayout>
                        {actionData?.testResult?.courier === "fgo" && (
                          <Banner tone={actionData.testResult.success ? "success" : "critical"} title={actionData.testResult.success ? t("conn_success") : t("conn_error")}>
                            {actionData.testResult.error && <Text>{actionData.testResult.error}</Text>}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>

                  </BlockStack>
                )}

                {/* ── Delivery & checks ────────────────────────────────────── */}
                {show("delivery") && (
                  <BlockStack gap="400">
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("free_ship_title")}</Text>
                        <Text tone="subdued">{t("free_ship_desc")}</Text>
                        <FormLayout>
                          <FormLayout.Group>
                            <TextField label={t("free_ship_threshold")} value={freeShippingThreshold} onChange={setFreeShippingThreshold}
                              type="number" min="0" step="1" suffix={currency} placeholder={t("free_ship_off")} autoComplete="off" />
                            <Select label={t("free_ship_scope")} value={freeShippingScope} onChange={setFreeShippingScope}
                              options={[{ label: t("free_ship_scope_all"), value: "all" }, { label: t("free_ship_scope_pickup"), value: "pickup" }]} />
                          </FormLayout.Group>
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("eta_title")}</Text>
                        <Text tone="subdued">{t("eta_desc")}</Text>
                        <FormLayout>
                          <Checkbox label={t("eta_show")} checked={showDeliveryEstimate} onChange={setShowDeliveryEstimate} />
                          <FormLayout.Group>
                            <TextField label={t("eta_cutoff")} value={dispatchCutoffHour} onChange={setDispatchCutoffHour} type="number" min="0" max="23" suffix=":00" helpText={t("eta_cutoff_help")} autoComplete="off" />
                            <TextField label={t("eta_processing")} value={processingDays} onChange={setProcessingDays} type="number" min="0" max="10" helpText={t("eta_processing_help")} autoComplete="off" />
                          </FormLayout.Group>
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("checks_title")}</Text>
                        <FormLayout>
                          <Checkbox label={t("checks_address")} checked={validateAddresses} onChange={setValidateAddresses} helpText={t("checks_address_help")} />
                          <TextField label={t("checks_refusals")} value={refusalWarnThreshold} onChange={setRefusalWarnThreshold} type="number" min="0" max="10" helpText={t("checks_refusals_help")} autoComplete="off" />
                          <TextField label={t("checks_block_cod")} value={blockCodAfterRefusals} onChange={setBlockCodAfterRefusals} type="number" min="0" max="10" helpText={t("checks_block_cod_help")} autoComplete="off" />
                        </FormLayout>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("routing_title")}</Text>
                        <Text tone="subdued">{t("routing_desc")}</Text>
                        {routingRules.map((rule, i) => (
                          <InlineStack key={i} gap="200" blockAlign="end" wrap>
                            <Box minWidth="180px">
                              <Select label={t("routing_when")} value={rule.field || "county"}
                                onChange={(v) => setRoutingRules(routingRules.map((x, j) => (j === i ? { ...x, field: v } : x)))}
                                options={[
                                  { label: t("routing_f_county"), value: "county" },
                                  { label: t("routing_f_city"), value: "city" },
                                  { label: t("routing_f_weight_over"), value: "weight_over" },
                                  { label: t("routing_f_total_over"), value: "total_over" },
                                  { label: t("routing_f_cod"), value: "cod" },
                                  { label: t("routing_f_pickup"), value: "pickup" },
                                ]} />
                            </Box>
                            {!["cod", "pickup"].includes(rule.field) && (
                              <Box minWidth="160px">
                                <TextField label={t("routing_value")} value={rule.value || ""} autoComplete="off"
                                  onChange={(v) => setRoutingRules(routingRules.map((x, j) => (j === i ? { ...x, value: v } : x)))}
                                  helpText={["county", "city"].includes(rule.field || "county") ? t("routing_value_list") : undefined} />
                              </Box>
                            )}
                            <Box minWidth="160px">
                              <Select label={t("routing_courier")} value={rule.courier || ""}
                                onChange={(v) => setRoutingRules(routingRules.map((x, j) => (j === i ? { ...x, courier: v } : x)))}
                                options={[{ label: "—", value: "" }, ...["fan", "sameday", "cargus", "gls", "packeta", "dpd"].map((c) => ({ label: c.toUpperCase(), value: c }))]} />
                            </Box>
                            <Button tone="critical" variant="plain" onClick={() => setRoutingRules(routingRules.filter((_, j) => j !== i))}>{t("routing_remove")}</Button>
                          </InlineStack>
                        ))}
                        <InlineStack>
                          <Button onClick={() => setRoutingRules([...routingRules, { field: "county", value: "", courier: "" }])}>{t("routing_add")}</Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingMd" fontWeight="semibold">{t("returns_title")}</Text>
                        <Text tone="subdued">{t("returns_desc")}</Text>
                        <FormLayout>
                          <Checkbox label={t("returns_enable")} checked={returnsEnabled} onChange={setReturnsEnabled} />
                          <FormLayout.Group>
                            <TextField label={t("returns_window")} value={returnsWindowDays} onChange={setReturnsWindowDays} type="number" min="1" max="90" autoComplete="off" />
                            <Select label={t("returns_courier")} value={returnsCourier} onChange={setReturnsCourier}
                              options={[{ label: t("returns_courier_same"), value: "" }, ...["fan", "cargus", "gls", "dpd", "packeta"].map((c) => ({ label: c.toUpperCase(), value: c }))]} />
                          </FormLayout.Group>
                          <TextField label={t("returns_instructions")} value={returnsInstructions} onChange={setReturnsInstructions} multiline={3} autoComplete="off" />
                          {returnsEnabled && (
                            <Banner tone="info">
                              <Text>{t("returns_link_info")} <Text as="span" fontWeight="semibold">https://{shop}/apps/rocourier/returns</Text></Text>
                            </Banner>
                          )}
                        </FormLayout>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}

              </BlockStack></Box>
            </Tabs>
          </Layout.Section>

          {/* ── Save + Test buttons ───────────────────────────────────── */}
          <Layout.Section>
            <Card>
              <InlineStack gap="300" align="start">
                <Button variant="primary" size="large" onClick={handleSave} loading={saving}>
                  {t("save_settings")}
                </Button>
                {show("fan") && fanEnabled && (
                  <Button onClick={() => handleTest("fan")} loading={saving}>
                    🔌 {t("test_connection")} FAN
                  </Button>
                )}
                {show("sameday") && samedayEnabled && (
                  <Button onClick={() => handleTest("sameday")} loading={saving}>
                    🔌 {t("test_connection")} Sameday
                  </Button>
                )}
                {show("cargus") && cargusEnabled && (
                  <Button onClick={() => handleTest("cargus")} loading={saving}>
                    🔌 {t("test_connection")} Cargus
                  </Button>
                )}
                {show("gls") && glsEnabled && (
                  <Button onClick={() => handleTest("gls")} loading={saving}>
                    🔌 {t("test_connection")} GLS
                  </Button>
                )}
                {show("packeta") && packetaEnabled && (
                  <Button onClick={() => handleTest("packeta")} loading={saving}>
                    🔌 {t("test_connection")} Packeta
                  </Button>
                )}
                {show("facturare") && smartbillEnabled && (
                  <Button onClick={() => handleTest("smartbill")} loading={saving}>
                    🔌 Test SmartBill
                  </Button>
                )}
                {show("dpd") && dpdEnabled && (
                  <Button onClick={() => handleTest("dpd")} loading={saving}>
                    🔌 {t("test_connection")} DPD
                  </Button>
                )}
                {show("facturare") && fgoEnabled && (
                  <Button onClick={() => handleTest("fgo")} loading={saving}>
                    🔌 Test FGO
                  </Button>
                )}
                {show("facturare") && oblioEnabled && (
                  <Button onClick={() => handleTest("oblio")} loading={saving}>
                    🔌 Test Oblio
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

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
