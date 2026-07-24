// app/routes/app.setup.jsx
// Onboarding wizard — 3-step setup guide shown on first install.
// Step 1: courier credentials configured
// Step 2: carrier service registered with Shopify
// Step 3: theme block added to cart page

import { useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

const APP_URL     = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const API_VERSION = "2025-01";
const CLIENT_ID   = "ec62c461418f2a1ece3f6e5fccc99154";
const BLOCK_HANDLE = "rocourier-cart";

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop, accessToken } = session;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  // If onboarding already completed, signal client to navigate to dashboard
  if (settings?.onboardingCompleted) return json({ redirectTo: "/app", shop: shop || "", step1Done: true, step2Done: true, step3Done: true, carrierId: null });

  // Step 1: courier configured?
  const step1Done = !!(
    (settings?.fanClientId && settings?.fanUsername) ||
    settings?.samedayUsername ||
    (settings?.cargusSubscriptionKey && settings?.cargusUsername) ||
    settings?.glsUsername ||
    settings?.packetaApiKey
  );

  // Step 2: carrier service registered?
  let step2Done = false;
  let carrierId = null;
  try {
    const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
    const res  = await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    const data = await res.json();
    const ours = (data.carrier_services || []).find((cs) => cs.callback_url === CALLBACK_URL);
    step2Done = !!ours;
    carrierId = ours?.id || null;
  } catch (_) {}

  // Step 3: theme block installed?
  let step3Done = false;
  try {
    // Get current theme ID first
    const themesRes = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    const themesData = await themesRes.json();
    const activeTheme = (themesData.themes || []).find((t) => t.role === "main");
    if (activeTheme) {
      const assetRes = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/themes/${activeTheme.id}/assets.json?asset[key]=config/settings_data.json`,
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      const assetData = await assetRes.json();
      const content = assetData.asset?.value || "";
      step3Done = content.includes(`shopify://apps/${BLOCK_HANDLE}`) ||
                  content.includes(`shopify://apps/rocourier`);
    }
  } catch (_) {}

  // Auto-complete if all steps done
  if (step1Done && step2Done && step3Done && settings) {
    await prisma.shopSettings.update({ where: { shop }, data: { onboardingCompleted: true } });
    return json({ redirectTo: "/app", shop, step1Done, step2Done, step3Done, carrierId });
  }

  return json({ redirectTo: null, shop, step1Done, step2Done, step3Done, carrierId });
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop, accessToken } = session;
  const body   = await request.json().catch(() => ({}));
  const intent = body.intent;

  if (intent === "register-carrier") {
    const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
    const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" };
    try {
      // Check if already registered
      const listRes  = await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services.json`, { headers });
      const listData = await listRes.json();
      const ours     = (listData.carrier_services || []).find((cs) => cs.callback_url === CALLBACK_URL);
      if (ours) return json({ success: true, alreadyRegistered: true });

      const createRes  = await fetch(`https://${shop}/admin/api/${API_VERSION}/carrier_services.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ carrier_service: { name: "Picklo", callback_url: CALLBACK_URL, service_discovery: true } }),
      });
      const createData = await createRes.json();
      if (createData.carrier_service?.id) return json({ success: true });
      return json({ success: false, error: JSON.stringify(createData) });
    } catch (e) {
      return json({ success: false, error: e.message });
    }
  }

  if (intent === "check-theme") {
    try {
      const headers     = { "X-Shopify-Access-Token": accessToken };
      const themesRes   = await fetch(`https://${shop}/admin/api/${API_VERSION}/themes.json`, { headers });
      const themesData  = await themesRes.json();
      const activeTheme = (themesData.themes || []).find((t) => t.role === "main");
      if (!activeTheme) return json({ found: false });

      const assetRes  = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/themes/${activeTheme.id}/assets.json?asset[key]=config/settings_data.json`,
        { headers }
      );
      const assetData = await assetRes.json();
      const content   = assetData.asset?.value || "";
      const found     = content.includes(`shopify://apps/${BLOCK_HANDLE}`) ||
                        content.includes(`shopify://apps/rocourier`);
      return json({ found });
    } catch (e) {
      return json({ found: false, error: e.message });
    }
  }

  if (intent === "complete" || intent === "skip") {
    await prisma.shopSettings.upsert({
      where:  { shop },
      update: { onboardingCompleted: true },
      create: { shop, onboardingCompleted: true },
    });
    return redirect("/app");
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Step badge helper ────────────────────────────────────────────────────────
function StepBadge({ done, active, t }) {
  if (done)   return <Badge tone="success">{t("setup_step_done")}</Badge>;
  if (active) return <Badge tone="attention">{t("setup_step_action")}</Badge>;
  return <Badge tone="new">{t("setup_step_waiting")}</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SetupWizard() {
  const { shop, step1Done, step2Done, step3Done, redirectTo } = useLoaderData();
  const { t } = useTranslation();
  const navigate  = useNavigate();
  const submit    = useSubmit();
  const navigation = useNavigation();

  useEffect(() => {
    if (redirectTo) navigate(redirectTo);
  }, [redirectTo]);

  const isSubmitting = navigation.state === "submitting";

  const stepsCompleted = [step1Done, step2Done, step3Done].filter(Boolean).length;
  const progressPct    = Math.round((stepsCompleted / 3) * 100);

  const THEME_EDITOR_URL = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${CLIENT_ID}/${BLOCK_HANDLE}&template=cart`;

  const handleRegister = () => {
    submit({ intent: "register-carrier" }, { method: "post", encType: "application/json" });
  };

  const handleCheckTheme = () => {
    submit({ intent: "check-theme" }, { method: "post", encType: "application/json" });
  };

  const handleOpenEditor = () => {
    window.open(THEME_EDITOR_URL, "_blank");
  };

  const handleComplete = () => {
    submit({ intent: "complete" }, { method: "post", encType: "application/json" });
  };

  const handleSkip = () => {
    submit({ intent: "skip" }, { method: "post", encType: "application/json" });
  };

  const allDone = step1Done && step2Done && step3Done;

  return (
    <Page
      title={t("setup_title")}
      subtitle={t("setup_subtitle")}
    >
      <Layout>
        {/* Progress */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued">{stepsCompleted} / 3 {t("setup_step_done").toLowerCase()}</Text>
                <Text variant="bodySm" tone="subdued">{progressPct}%</Text>
              </InlineStack>
              <ProgressBar progress={progressPct} size="small" tone={allDone ? "success" : "primary"} />
            </BlockStack>
          </Card>
        </Layout.Section>

        {allDone && (
          <Layout.Section>
            <Banner tone="success">
              <Text>{t("setup_all_done")}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Step 1 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: step1Done ? "#008060" : "#5c6ac4",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
                      {step1Done ? "✓" : "1"}
                    </span>
                  </div>
                  <BlockStack gap="100">
                    <Text variant="headingSm" fontWeight="semibold">{t("setup_step1_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("setup_step1_desc")}</Text>
                  </BlockStack>
                </InlineStack>
                <StepBadge done={step1Done} active={!step1Done} t={t} />
              </InlineStack>

              {!step1Done && (
                <>
                  <Divider />
                  <InlineStack>
                    <Button onClick={() => navigate("/app/settings")}>
                      {t("setup_action_configure")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 2 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: step2Done ? "#008060" : step1Done ? "#5c6ac4" : "#e1e3e5",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: step1Done || step2Done ? "#fff" : "#8c9196", fontSize: 14, fontWeight: 700 }}>
                      {step2Done ? "✓" : "2"}
                    </span>
                  </div>
                  <BlockStack gap="100">
                    <Text variant="headingSm" fontWeight="semibold">{t("setup_step2_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("setup_step2_desc")}</Text>
                  </BlockStack>
                </InlineStack>
                <StepBadge done={step2Done} active={step1Done && !step2Done} t={t} />
              </InlineStack>

              {step1Done && !step2Done && (
                <>
                  <Divider />
                  <InlineStack>
                    <Button
                      variant="primary"
                      onClick={handleRegister}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      {t("setup_action_register")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 3 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: step3Done ? "#008060" : step2Done ? "#5c6ac4" : "#e1e3e5",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: step2Done || step3Done ? "#fff" : "#8c9196", fontSize: 14, fontWeight: 700 }}>
                      {step3Done ? "✓" : "3"}
                    </span>
                  </div>
                  <BlockStack gap="100">
                    <Text variant="headingSm" fontWeight="semibold">{t("setup_step3_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("setup_step3_desc")}</Text>
                  </BlockStack>
                </InlineStack>
                <StepBadge done={step3Done} active={step2Done && !step3Done} t={t} />
              </InlineStack>

              {step2Done && !step3Done && (
                <>
                  <Divider />
                  <InlineStack gap="300">
                    <Button variant="primary" onClick={handleOpenEditor}>
                      {t("setup_action_open_editor")}
                    </Button>
                    <Button
                      onClick={handleCheckTheme}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? t("setup_checking") : t("setup_action_check")}
                    </Button>
                  </InlineStack>
                </>
              )}

              {/* Show check button even after opening editor */}
              {step2Done && step3Done && (
                <>
                  <Divider />
                  <InlineStack>
                    <Button
                      onClick={handleCheckTheme}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? t("setup_checking") : t("setup_action_check")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Footer actions */}
        <Layout.Section>
          <InlineStack align="space-between">
            {allDone ? (
              <Button variant="primary" onClick={handleComplete} loading={isSubmitting}>
                {t("setup_complete")}
              </Button>
            ) : (
              <div />
            )}
            <Button variant="plain" onClick={handleSkip} disabled={isSubmitting}>
              {t("setup_skip")}
            </Button>
          </InlineStack>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
