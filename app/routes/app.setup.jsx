// app/routes/app.setup.jsx
// Onboarding wizard — 3-step setup guide shown on first install.
// Step 1: a courier is enabled with credentials
// Step 2: Picklo's delivery options in checkout (live rates with CCS, fixed rates without)
// Step 3: the Picklo Shipping app block on the theme's cart page

import { useEffect, useState } from "react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation, useActionData, useRevalidator } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { setupCheckout } from "../services/checkout-setup.server.js";
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
  Select,
  List,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

const CLIENT_ID = process.env.SHOPIFY_API_KEY || "";
// Theme app extension block: extensions/rocourier-cart/blocks/shipping-selector.liquid
const APP_BLOCK_HANDLE = "shipping-selector";
const COURIERS = ["fan", "sameday", "cargus", "gls", "packeta"];

const numericId = (gid) => String(gid).split("/").pop();

// Cart template of a theme: does it exist (Online Store 2.0) and does it hold Picklo's block?
async function inspectTheme(admin, themeId) {
  const res = await admin.graphql(
    `query CartTemplate($themeId: ID!) {
      theme(id: $themeId) {
        files(filenames: ["templates/cart.json"], first: 1) {
          nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }`,
    { variables: { themeId } }
  );
  const data = await res.json();
  const file = data.data?.theme?.files?.nodes?.[0];
  const content = file?.body?.content || "";
  return { supportsAppBlocks: !!file, blockAdded: content.includes(`/blocks/${APP_BLOCK_HANDLE}/`) };
}

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  // Already completed — signal client-side navigation (avoid server redirect breaking auth)
  if (settings?.onboardingCompleted) {
    return json({ redirectTo: "/app", shop, clientId: CLIENT_ID, step1Done: true, step2Done: true, step3Done: true, themes: [] });
  }

  const step1Done = COURIERS.some((c) => settings?.[`${c}Enabled`]);
  const step2Done = ["ccs", "manual"].includes(settings?.checkoutMode);

  // Themes the merchant can add the block to (live one first)
  let themes = [];
  let theme = null;
  try {
    const res = await admin.graphql(`{ themes(first: 25, roles: [MAIN, UNPUBLISHED]) { nodes { id name role } } }`);
    const data = await res.json();
    themes = (data.data?.themes?.nodes || []).sort((a, b) => (a.role === "MAIN" ? -1 : b.role === "MAIN" ? 1 : 0));
    const wanted = new URL(request.url).searchParams.get("theme");
    const selected = themes.find((t) => numericId(t.id) === wanted) || themes[0];
    if (selected) theme = { id: numericId(selected.id), ...(await inspectTheme(admin, selected.id)) };
  } catch (e) {
    console.error("[setup] theme lookup failed:", e?.message || e);
  }

  return json({
    redirectTo: null, shop, clientId: CLIENT_ID, step1Done, step2Done, step3Done: !!theme?.blockAdded,
    checkoutMode: settings?.checkoutMode || null, lockerCount: settings?.checkoutLockerCount ?? 3,
    themes: themes.map((t) => ({ id: numericId(t.id), name: t.name, live: t.role === "MAIN" })), theme,
  });
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  const body   = await request.json().catch(() => ({}));
  const intent = body.intent;

  // Same automatic setup as Settings → Delivery options in checkout: works with
  // and without carrier-calculated shipping, so it never fails on a plan limit.
  if (intent === "setup-checkout") {
    try {
      const r = await setupCheckout(admin, shop);
      return json({ intent, success: true, mode: r.mode, zones: r.zones || [] });
    } catch (e) {
      return json({ intent, success: false, error: e.message });
    }
  }

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

function StepHeader({ n, done, active, title, desc, t, children }) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <StepNum n={n} done={done} active={active} />
        <BlockStack gap="050">
          <Text variant="headingSm" fontWeight="semibold">{title}</Text>
          <Text variant="bodySm" tone="subdued">{desc}</Text>
          {children}
        </BlockStack>
      </InlineStack>
      <StepBadge done={done} active={active} t={t} />
    </InlineStack>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SetupWizard() {
  const { shop, clientId, step1Done, step2Done, step3Done, redirectTo, checkoutMode, lockerCount, themes, theme } = useLoaderData();
  const actionData  = useActionData();
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const submit      = useSubmit();
  const navigation  = useNavigation();
  const revalidator = useRevalidator();

  const [pendingIntent, setPendingIntent] = useState(null);
  const [step2Skipped, setStep2Skipped] = useState(false);

  useEffect(() => { if (redirectTo) navigate(redirectTo); }, [redirectTo]);
  useEffect(() => { if (navigation.state === "idle") setPendingIntent(null); }, [navigation.state]);

  const isSubmitting = navigation.state === "submitting";
  const checking     = revalidator.state === "loading";

  const step2Ok        = step2Done || step2Skipped;
  const stepsCompleted = [step1Done, step2Ok, step3Done].filter(Boolean).length;
  const progressPct    = Math.round((stepsCompleted / 3) * 100);
  const allDone        = step1Done && step2Ok && step3Done;

  // Opens the theme editor on the cart template with Picklo's block already added
  const editorUrl = theme
    ? `https://${shop}/admin/themes/${theme.id}/editor?template=cart&addAppBlockId=${clientId}/${APP_BLOCK_HANDLE}&target=newAppsSection`
    : `https://${shop}/admin/themes/current/editor?template=cart`;

  const doSubmit = (intent) => {
    setPendingIntent(intent);
    submit({ intent }, { method: "post", encType: "application/json" });
  };

  const setupResult = actionData?.intent === "setup-checkout" ? actionData : null;
  const mode  = setupResult?.success ? setupResult.mode : checkoutMode;
  const zones = setupResult?.zones?.join(", ") || "—";

  return (
    <Page title={t("setup_title")} subtitle={t("setup_subtitle")}>
      <Layout>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued">{t("setup_progress", { done: stepsCompleted })}</Text>
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

        {/* ── Step 1: Courier ─────────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <StepHeader n="1" done={step1Done} active={!step1Done} t={t}
                title={t("setup_step1_title")} desc={t("setup_step1_desc")} />
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

        {/* ── Step 2: Delivery options in checkout ────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <StepHeader n="2" done={step2Ok} active={step1Done && !step2Ok} t={t}
                title={t("setup_step2_title")} desc={t("setup_step2_desc")}>
                {step2Skipped && !step2Done && <Text variant="bodySm" tone="subdued">{t("setup_step2_skipped")}</Text>}
              </StepHeader>

              {mode === "ccs" && <Banner tone="success"><Text>{t("checkout_mode_ccs", { n: lockerCount, zones })}</Text></Banner>}
              {mode === "manual" && <Banner tone="info"><Text>{t("checkout_mode_manual", { zones })}</Text></Banner>}
              {setupResult && !setupResult.success && (
                <Banner tone="warning"><Text>{setupResult.error}</Text></Banner>
              )}

              {step1Done && !step2Done && !step2Skipped && (
                <>
                  <Divider />
                  <InlineStack gap="300">
                    <Button variant="primary" onClick={() => doSubmit("setup-checkout")}
                      loading={pendingIntent === "setup-checkout" && isSubmitting} disabled={isSubmitting}>
                      {t("setup_action_register")}
                    </Button>
                    <Button variant="plain" onClick={() => setStep2Skipped(true)} disabled={isSubmitting}>
                      {t("setup_skip_step")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Step 3: Cart page app block ─────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <StepHeader n="3" done={step3Done} active={step1Done && !step3Done} t={t}
                title={t("setup_step3_title")} desc={t("setup_step3_desc")} />

              {step3Done && <Banner tone="success"><Text>{t("setup_theme_found")}</Text></Banner>}

              {step1Done && !step3Done && (
                <>
                  <Divider />
                  {themes.length > 0 && (
                    <Select
                      label={t("setup_theme_label")}
                      options={themes.map((th) => ({ value: th.id, label: th.live ? `${th.name} (${t("setup_theme_live")})` : th.name }))}
                      value={theme?.id || ""}
                      onChange={(id) => navigate(`?theme=${id}`, { replace: true })}
                    />
                  )}

                  {theme && !theme.supportsAppBlocks ? (
                    <Banner tone="warning"><Text>{t("setup_theme_vintage")}</Text></Banner>
                  ) : (
                    <BlockStack gap="200">
                      <Text variant="headingSm">{t("setup_theme_howto")}</Text>
                      <List type="number">
                        <List.Item>{t("setup_theme_i1")}</List.Item>
                        <List.Item>{t("setup_theme_i2")}</List.Item>
                        <List.Item>{t("setup_theme_i3")}</List.Item>
                        <List.Item>{t("setup_theme_i4")}</List.Item>
                      </List>
                      <Text variant="bodySm" tone="subdued">{t("setup_theme_note")}</Text>
                    </BlockStack>
                  )}

                  <InlineStack gap="300">
                    {(!theme || theme.supportsAppBlocks) && (
                      <Button variant="primary" url={editorUrl} target="_blank">{t("setup_action_open_editor")}</Button>
                    )}
                    <Button onClick={() => revalidator.revalidate()} loading={checking}>
                      {checking ? t("setup_checking") : t("setup_action_check")}
                    </Button>
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="space-between">
            {allDone ? (
              <Button variant="primary" onClick={() => doSubmit("complete")}
                loading={pendingIntent === "complete" && isSubmitting}>
                {t("setup_complete")}
              </Button>
            ) : <div />}
            <Button variant="plain" onClick={() => doSubmit("skip-all")} disabled={isSubmitting}>
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
