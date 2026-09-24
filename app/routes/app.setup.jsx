// app/routes/app.setup.jsx
// Onboarding wizard — 3-step setup guide shown on first install.
// Step 1: courier credentials configured
// Step 2: carrier service registered (optional — requires Shopify Advanced / CCS)
// Step 3: theme block added to cart page

import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation, useActionData } from "@remix-run/react";
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

const APP_URL   = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const CLIENT_ID = "ec62c461418f2a1ece3f6e5fccc99154";
const BLOCK_HANDLE = "rocourier-cart";

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  // Already completed — signal client-side navigation (avoid server redirect breaking auth)
  if (settings?.onboardingCompleted) {
    return json({ redirectTo: "/app", shop, step1Done: true, step2Done: true, step3Done: true });
  }

  // Step 1: any courier credentials present?
  const step1Done = !!(
    (settings?.fanClientId && settings?.fanUsername) ||
    settings?.samedayUsername ||
    (settings?.cargusSubscriptionKey && settings?.cargusUsername) ||
    settings?.glsUsername ||
    settings?.packetaApiKey
  );

  // Step 2: carrier service registered? (Admin GraphQL API)
  let step2Done = false;
  try {
    const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
    const csRes  = await admin.graphql(`{ deliveryCarrierServices(first: 50) { nodes { callbackUrl } } }`);
    const csData = await csRes.json();
    step2Done    = !!(csData.data?.deliveryCarrierServices?.nodes || []).find((cs) => cs.callbackUrl === CALLBACK_URL);
  } catch (_) {}

  // Step 3: Picklo block in active theme? (Admin GraphQL API)
  let step3Done = false;
  try {
    const themesRes  = await admin.graphql(`{ themes(first: 25) { nodes { id role } } }`);
    const themesData = await themesRes.json();
    const activeTheme = (themesData.data?.themes?.nodes || []).find((t) => t.role === "MAIN");
    if (activeTheme) {
      const fileRes  = await admin.graphql(
        `query GetThemeFile($themeId: ID!) {
          theme(id: $themeId) {
            file(filename: "config/settings_data.json") {
              body { ... on OnlineStoreThemeFileBodyText { content } }
            }
          }
        }`,
        { variables: { themeId: activeTheme.id } }
      );
      const fileData = await fileRes.json();
      const content  = fileData.data?.theme?.file?.body?.content || "";
      step3Done = content.includes(`shopify://apps/${BLOCK_HANDLE}`) ||
                  content.includes("shopify://apps/rocourier");
    }
  } catch (_) {}

  // All done — auto-complete
  if (step1Done && step2Done && step3Done && settings) {
    await prisma.shopSettings.update({ where: { shop }, data: { onboardingCompleted: true } });
    return json({ redirectTo: "/app", shop, step1Done, step2Done, step3Done });
  }

  return json({ redirectTo: null, shop, step1Done, step2Done, step3Done });
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  const body   = await request.json().catch(() => ({}));
  const intent = body.intent;

  // ── Register carrier service (Admin GraphQL API) ──────────────────────────
  if (intent === "register-carrier") {
    const CALLBACK_URL = `${APP_URL.replace(/\/$/, "")}/carrier-service`;
    try {
      const listRes  = await admin.graphql(`{ deliveryCarrierServices(first: 50) { nodes { id callbackUrl } } }`);
      const listData = await listRes.json();
      const ours     = (listData.data?.deliveryCarrierServices?.nodes || []).find((cs) => cs.callbackUrl === CALLBACK_URL);
      if (ours) return json({ intent, success: true, alreadyRegistered: true });

      const createRes  = await admin.graphql(
        `mutation deliveryCarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
          deliveryCarrierServiceCreate(input: $input) {
            carrierService { id name callbackUrl }
            userErrors { field message }
          }
        }`,
        { variables: { input: { name: "Picklo", callbackUrl: CALLBACK_URL, supportsServiceDiscovery: true } } }
      );
      const createData = await createRes.json();
      const cs         = createData.data?.deliveryCarrierServiceCreate?.carrierService;
      const errors     = createData.data?.deliveryCarrierServiceCreate?.userErrors || [];
      if (cs?.id) return json({ intent, success: true });
      return json({ intent, success: false, error: errors[0]?.message || JSON.stringify(createData) });
    } catch (e) {
      return json({ intent, success: false, error: e.message });
    }
  }

  // ── Check theme block (Admin GraphQL API) ─────────────────────────────────
  if (intent === "check-theme") {
    try {
      const themesRes  = await admin.graphql(`{ themes(first: 25) { nodes { id role } } }`);
      const themesData = await themesRes.json();
      const activeTheme = (themesData.data?.themes?.nodes || []).find((t) => t.role === "MAIN");
      if (!activeTheme) return json({ intent, found: false });

      const fileRes  = await admin.graphql(
        `query GetThemeFile($themeId: ID!) {
          theme(id: $themeId) {
            file(filename: "config/settings_data.json") {
              body { ... on OnlineStoreThemeFileBodyText { content } }
            }
          }
        }`,
        { variables: { themeId: activeTheme.id } }
      );
      const fileData = await fileRes.json();
      const content  = fileData.data?.theme?.file?.body?.content || "";
      const found    = content.includes(`shopify://apps/${BLOCK_HANDLE}`) ||
                       content.includes("shopify://apps/rocourier");
      return json({ intent, found });
    } catch (e) {
      return json({ intent, found: false, error: e.message });
    }
  }

  // ── Complete or skip all ──────────────────────────────────────────────────
  if (intent === "complete" || intent === "skip-all") {
    await prisma.shopSettings.upsert({
      where:  { shop },
      update: { onboardingCompleted: true },
      create: { shop, onboardingCompleted: true },
    });
    return redirect("/app");
  }

  return json({ intent, error: "Unknown intent" }, { status: 400 });
}

// ─── Step number bubble ───────────────────────────────────────────────────────
function StepNum({ n, done, active }) {
  const bg = done ? "#008060" : active ? "#5c6ac4" : "#e1e3e5";
  const fg = done || active ? "#fff" : "#8c9196";
  return (
    <div style={{ width: 36, height: 36, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ color: fg, fontSize: 14, fontWeight: 700 }}>{done ? "✓" : n}</span>
    </div>
  );
}

function StepBadge({ done, active, t }) {
  if (done)   return <Badge tone="success">{t("setup_step_done")}</Badge>;
  if (active) return <Badge tone="attention">{t("setup_step_action")}</Badge>;
  return <Badge tone="new">{t("setup_step_waiting")}</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SetupWizard() {
  const { shop, step1Done, step2Done, step3Done, redirectTo } = useLoaderData();
  const actionData  = useActionData();
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const submit      = useSubmit();
  const navigation  = useNavigation();

  // Track which intent is currently in-flight
  const [pendingIntent, setPendingIntent] = useState(null);
  // Allow skipping step 2 without a server round-trip
  const [step2Skipped, setStep2Skipped] = useState(false);

  // Client-side redirect (avoids stripping Shopify auth params)
  useEffect(() => { if (redirectTo) navigate(redirectTo); }, [redirectTo]);

  // Clear pending intent once navigation settles
  useEffect(() => {
    if (navigation.state === "idle") setPendingIntent(null);
  }, [navigation.state]);

  const isSubmitting = navigation.state === "submitting";

  const stepsCompleted = [step1Done, step2Done || step2Skipped, step3Done].filter(Boolean).length;
  const progressPct    = Math.round((stepsCompleted / 3) * 100);
  const allDone        = step1Done && (step2Done || step2Skipped) && step3Done;

  const THEME_EDITOR_URL = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${CLIENT_ID}/${BLOCK_HANDLE}&template=cart`;

  const doSubmit = (intent) => {
    setPendingIntent(intent);
    submit({ intent }, { method: "post", encType: "application/json" });
  };

  // Action result banners
  const lastIntent       = actionData?.intent;
  const carrierSuccess   = lastIntent === "register-carrier" && actionData?.success;
  const carrierError     = lastIntent === "register-carrier" && !actionData?.success ? actionData?.error : null;
  const themeFound       = lastIntent === "check-theme" && actionData?.found;
  const themeNotFound    = lastIntent === "check-theme" && !actionData?.found;

  return (
    <Page title={t("setup_title")} subtitle={t("setup_subtitle")}>
      <Layout>

        {/* Progress bar */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued">{stepsCompleted} / 3 completați</Text>
                <Text variant="bodySm" tone="subdued">{progressPct}%</Text>
              </InlineStack>
              <ProgressBar progress={progressPct} size="small" tone={allDone ? "success" : "primary"} />
            </BlockStack>
          </Card>
        </Layout.Section>

        {allDone && (
          <Layout.Section>
            <Banner tone="success"><Text>{t("setup_all_done")}</Text></Banner>
          </Layout.Section>
        )}

        {/* ── Step 1: Courier credentials ─────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <StepNum n="1" done={step1Done} active={!step1Done} />
                  <BlockStack gap="050">
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
                    <Button onClick={() => navigate("/app/settings")}>{t("setup_action_configure")}</Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Step 2: Carrier service (optional) ──────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <StepNum n="2" done={step2Done || step2Skipped} active={step1Done && !step2Done && !step2Skipped} />
                  <BlockStack gap="050">
                    <Text variant="headingSm" fontWeight="semibold">{t("setup_step2_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("setup_step2_desc")}</Text>
                    {!step2Done && !step2Skipped && (
                      <Text variant="bodySm" tone="subdued">
                        Opțional — necesită Shopify Advanced sau "Calculated shipping at checkout" activat.
                      </Text>
                    )}
                    {step2Skipped && (
                      <Text variant="bodySm" tone="subdued">Sărit — widget-ul funcționează, dar ratele de livrare nu sunt calculate dinamic.</Text>
                    )}
                  </BlockStack>
                </InlineStack>
                <StepBadge done={step2Done || step2Skipped} active={step1Done && !step2Done && !step2Skipped} t={t} />
              </InlineStack>

              {carrierSuccess && (
                <Banner tone="success"><Text>{t("setup_carrier_success")}</Text></Banner>
              )}
              {carrierError && (
                <Banner tone="warning">
                  <BlockStack gap="100">
                    <Text fontWeight="semibold">Nu s-a putut înregistra serviciul de curier.</Text>
                    <Text variant="bodySm">{carrierError}</Text>
                  </BlockStack>
                </Banner>
              )}

              {step1Done && !step2Done && !step2Skipped && (
                <>
                  <Divider />
                  <InlineStack gap="300">
                    <Button
                      variant="primary"
                      onClick={() => doSubmit("register-carrier")}
                      loading={pendingIntent === "register-carrier" && isSubmitting}
                      disabled={isSubmitting}
                    >
                      {t("setup_action_register")}
                    </Button>
                    <Button variant="plain" onClick={() => setStep2Skipped(true)} disabled={isSubmitting}>
                      Sari peste pasul 2
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Step 3: Theme block ──────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <StepNum n="3" done={step3Done} active={step1Done && !step3Done} />
                  <BlockStack gap="050">
                    <Text variant="headingSm" fontWeight="semibold">{t("setup_step3_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("setup_step3_desc")}</Text>
                  </BlockStack>
                </InlineStack>
                <StepBadge done={step3Done} active={step1Done && !step3Done} t={t} />
              </InlineStack>

              {themeFound && (
                <Banner tone="success"><Text>{t("setup_theme_found")}</Text></Banner>
              )}
              {themeNotFound && (
                <Banner tone="warning"><Text>{t("setup_theme_not_found")}</Text></Banner>
              )}

              {step1Done && (
                <>
                  <Divider />
                  <InlineStack gap="300">
                    {!step3Done && (
                      <Button variant="primary" onClick={() => window.open(THEME_EDITOR_URL, "_blank")}>
                        {t("setup_action_open_editor")}
                      </Button>
                    )}
                    <Button
                      onClick={() => doSubmit("check-theme")}
                      loading={pendingIntent === "check-theme" && isSubmitting}
                      disabled={isSubmitting}
                    >
                      {pendingIntent === "check-theme" && isSubmitting ? t("setup_checking") : t("setup_action_check")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Footer actions ───────────────────────────────────────────────── */}
        <Layout.Section>
          <InlineStack align="space-between">
            {allDone ? (
              <Button variant="primary" onClick={() => doSubmit("complete")}
                loading={pendingIntent === "complete" && isSubmitting}>
                {t("setup_complete")}
              </Button>
            ) : <div />}
            <Button variant="plain" onClick={() => doSubmit("skip-all")}
              disabled={isSubmitting}>
              {t("setup_skip")}
            </Button>
          </InlineStack>
        </Layout.Section>

      </Layout>
    </Page>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
