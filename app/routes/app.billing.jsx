// app/routes/app.billing.jsx
// Plan management & billing page
import { useState, useEffect, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button,
  Banner, Divider, TextField, ProgressBar, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { useTranslation } from "../context/i18n.jsx";

const TRIAL_LIMIT   = 10;
const APP_URL       = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
// Always test mode — Shopify reviewers must be able to approve without real charges
const BILLING_TEST  = true;

const PLANS = {
  monthly:  { name: "Pro Monthly",  price: 19.00,  interval: "EVERY_30_DAYS" },
  yearly:   { name: "Pro Yearly",   price: 149.00, interval: "ANNUAL" },
  lifetime: { name: "Pro Lifetime", price: 299.00, interval: null },
};

// ─────────────────────────────────────────────────────────────────────────────
// Loader — charge verification is handled by /auth/billing-callback
// ─────────────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop }    = session;

  const url       = new URL(request.url);
  const activated = url.searchParams.get("activated") === "1";
  const settings  = await prisma.shopSettings.findUnique({ where: { shop } });

  return json({
    shop,
    planType:    settings?.planType          || "trial",
    awbCount:    settings?.awbCount          || 0,
    chargeId:    settings?.shopifyChargeId   || null,
    activatedAt: settings?.planActivatedAt   || null,
    activated,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Action — subscribe (creates Shopify charge) OR apply gift code
// ─────────────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const formData = await request.formData();
  const intent   = formData.get("intent");

  // ── Apply gift code ──────────────────────────────────────────────────────────
  if (intent === "apply-gift") {
    const code = String(formData.get("code") || "").trim().toUpperCase();
    if (!code) return json({ error: "Introdu un cod." });

    const dc = await prisma.discountCode.findUnique({ where: { code } });
    if (!dc || !dc.active || dc.type !== "lifetime_gift") {
      return json({ error: "Cod invalid sau expirat." });
    }
    if (dc.maxUses !== null && dc.usedCount >= dc.maxUses) {
      return json({ error: "Codul a atins limita de utilizări." });
    }

    const already = await prisma.discountCodeUsage.findUnique({
      where: { code_shop: { code, shop } },
    });
    if (already) return json({ error: "Ai folosit deja acest cod." });

    await prisma.$transaction([
      prisma.shopSettings.update({
        where: { shop },
        data: { planType: "lifetime", shopifyChargeId: null, planActivatedAt: new Date() },
      }),
      prisma.discountCode.update({
        where: { code },
        data: { usedCount: { increment: 1 } },
      }),
      prisma.discountCodeUsage.create({ data: { code, shop } }),
    ]);

    return json({ giftActivated: true });
  }

  // ── Subscribe — create Shopify charge ────────────────────────────────────────
  if (intent === "subscribe") {
    const plan         = formData.get("plan");
    const discountCode = String(formData.get("discountCode") || "").trim().toUpperCase();

    const planConfig = PLANS[plan];
    if (!planConfig) return json({ error: "Plan invalid." });

    let price = planConfig.price;

    if (discountCode) {
      const dc = await prisma.discountCode.findUnique({ where: { code: discountCode } });
      const alreadyUsed = dc ? await prisma.discountCodeUsage.findUnique({
        where: { code_shop: { code: discountCode, shop } },
      }) : null;

      if (!dc || !dc.active || dc.type !== "percent") {
        return json({ error: "Codul de reducere nu este valid." });
      }
      if (dc.maxUses !== null && dc.usedCount >= dc.maxUses) {
        return json({ error: "Codul a atins limita de utilizări." });
      }
      if (alreadyUsed) {
        return json({ error: "Ai folosit deja acest cod de reducere." });
      }

      price = parseFloat((price * (1 - dc.percentOff / 100)).toFixed(2));

      await prisma.$transaction([
        prisma.discountCode.update({ where: { code: discountCode }, data: { usedCount: { increment: 1 } } }),
        prisma.discountCodeUsage.create({ data: { code: discountCode, shop } }),
      ]);
    }

    // Callback route handles charge verification without needing embedded app context.
    // Using the Shopify admin URL causes "To install" page for unpublished apps.
    const returnUrl = `${APP_URL}/auth/billing-callback?shop=${shop}`;

    try {
      let confirmationUrl;

      if (plan === "lifetime") {
        const res = await admin.graphql(`
          mutation appPurchaseOneTimeCreate($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean!) {
            appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
              appPurchaseOneTime { id status }
              confirmationUrl
              userErrors { field message }
            }
          }
        `, {
          variables: {
            name:      planConfig.name,
            price:     { amount: price, currencyCode: "USD" },
            returnUrl,
            test:      BILLING_TEST,
          },
        });
        const body = await res.json();
        const result = body?.data?.appPurchaseOneTimeCreate;
        if (result?.userErrors?.length) {
          return json({ error: result.userErrors.map((e) => e.message).join(". ") });
        }
        confirmationUrl = result?.confirmationUrl;

      } else {
        const res = await admin.graphql(`
          mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean!) {
            appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test) {
              appSubscription { id status }
              confirmationUrl
              userErrors { field message }
            }
          }
        `, {
          variables: {
            name:      planConfig.name,
            returnUrl,
            test:      BILLING_TEST,
            lineItems: [{
              plan: {
                appRecurringPricingDetails: {
                  price:    { amount: price, currencyCode: "USD" },
                  interval: planConfig.interval,
                },
              },
            }],
          },
        });
        const body = await res.json();
        const result = body?.data?.appSubscriptionCreate;
        if (result?.userErrors?.length) {
          return json({ error: result.userErrors.map((e) => e.message).join(". ") });
        }
        confirmationUrl = result?.confirmationUrl;
      }

      if (!confirmationUrl) return json({ error: "Nu am putut crea subscripția. Încearcă din nou." });
      return json({ confirmationUrl });

    } catch (e) {
      console.error("[Billing] subscribe error:", e);
      return json({ error: e.message });
    }
  }

  return json({ error: "Intent invalid." });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
function PlanCard({ planKey, current, onSelect, loading, isSwitch, t }) {
  const isCurrent = current === planKey ||
    (planKey === "monthly"  && current === "pro_monthly") ||
    (planKey === "yearly"   && current === "pro_yearly")  ||
    (planKey === "lifetime" && current === "lifetime");

  const planLabel = t(`billing_${planKey}_price`);
  const planBadge = planKey === "yearly"   ? t("billing_save_pct") :
                    planKey === "lifetime" ? t("billing_one_time_badge") : null;
  const planDesc  = t(`billing_${planKey}_desc`);

  const btnLabel = isCurrent ? t("billing_plan_active") :
    planKey === "lifetime" ? (isSwitch ? t("billing_upgrade_lifetime") : t("billing_buy_license")) :
    isSwitch ? t("billing_switch_plan") : t("billing_subscribe");

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingMd" fontWeight="semibold">{planLabel}</Text>
            {planBadge && <Badge tone="success">{planBadge}</Badge>}
          </BlockStack>
          {isCurrent && <Badge tone="success">{t("billing_plan_active")}</Badge>}
        </InlineStack>
        <Text variant="bodySm" tone="subdued">{planDesc}</Text>
        {isCurrent ? (
          <Button disabled fullWidth>{t("billing_plan_active")}</Button>
        ) : (
          <Button variant="primary" onClick={() => onSelect(planKey)} loading={loading} fullWidth>
            {btnLabel}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}

export default function BillingPage() {
  const { planType, awbCount, activated } = useLoaderData();
  const actionData  = useActionData();
  const submit      = useSubmit();
  const navigation  = useNavigation();
  const { t }       = useTranslation();
  const isSubmitting = navigation.state === "submitting";

  const [giftCode,      setGiftCode]      = useState("");
  const [discountCode,  setDiscountCode]  = useState("");
  const [selectedPlan,  setSelectedPlan]  = useState(null);
  const [toast,         setToast]         = useState(null);

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData]);

  useEffect(() => {
    if (activated) setToast(t("billing_activated_toast"));
    if (actionData?.giftActivated) setToast(t("billing_gift_activated_toast"));
  }, [activated, actionData]);

  const isActive   = planType !== "trial";
  const isLifetime = planType === "lifetime";
  const trialLeft  = Math.max(0, TRIAL_LIMIT - awbCount);
  const trialPct   = Math.min(100, (awbCount / TRIAL_LIMIT) * 100);

  const handleSubscribe = useCallback((plan) => {
    setSelectedPlan(plan);
    submit({ intent: "subscribe", plan, discountCode }, { method: "post" });
  }, [submit, discountCode]);

  const handleGift = useCallback(() => {
    submit({ intent: "apply-gift", code: giftCode }, { method: "post" });
  }, [submit, giftCode]);

  return (
    <Page
      title={t("billing_page_title")}
      subtitle={t("billing_subtitle")}
    >
      {toast && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" onDismiss={() => setToast(null)}>{toast}</Banner>
        </div>
      )}
      {actionData?.error && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="critical" title={t("error")}>{actionData.error}</Banner>
        </div>
      )}

      <Layout>
        {/* ── Current plan status ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="semibold">{t("billing_current_plan")}</Text>
                {planType === "trial"       && <Badge tone="warning">Trial</Badge>}
                {planType === "pro_monthly" && <Badge tone="success">Pro Monthly</Badge>}
                {planType === "pro_yearly"  && <Badge tone="success">Pro Yearly</Badge>}
                {planType === "lifetime"    && <Badge tone="success">Lifetime</Badge>}
              </InlineStack>

              {planType === "trial" && (
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm">{t("billing_awbs_used")}</Text>
                    <Text variant="bodySm" fontWeight="semibold">{awbCount} / {TRIAL_LIMIT}</Text>
                  </InlineStack>
                  <ProgressBar progress={trialPct} tone={trialLeft === 0 ? "critical" : trialLeft <= 3 ? "warning" : "highlight"} />
                  {trialLeft === 0 && (
                    <Banner tone="critical" title={t("billing_trial_expired_title")}>
                      {t("billing_trial_expired_desc", { n: TRIAL_LIMIT })}
                    </Banner>
                  )}
                  {trialLeft > 0 && trialLeft <= 3 && (
                    <Banner tone="warning">
                      {t("billing_trial_warning", { n: trialLeft })}
                    </Banner>
                  )}
                  {trialLeft > 3 && (
                    <Text variant="bodySm" tone="subdued">{t("billing_trial_left", { n: trialLeft })}</Text>
                  )}
                </BlockStack>
              )}

              {isActive && (
                <Banner tone="success">
                  {t("billing_active_banner")}
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Plan cards — shown for trial + active non-lifetime users ── */}
        {!isLifetime && (
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">
                {isActive ? t("billing_change_plan") : t("billing_choose_plan")}
              </Text>
              {isActive && (
                <Banner tone="info">
                  {t("billing_switch_info")}
                </Banner>
              )}
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                {Object.keys(PLANS).map((key) => (
                  <PlanCard
                    key={key}
                    planKey={key}
                    current={planType}
                    onSelect={handleSubscribe}
                    loading={isSubmitting && selectedPlan === key}
                    isSwitch={isActive}
                    t={t}
                  />
                ))}
              </InlineGrid>

              {/* Discount code for paid plans */}
              {!isActive && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" fontWeight="semibold">{t("billing_discount_title")}</Text>
                    <Text variant="bodySm" tone="subdued">{t("billing_discount_desc")}</Text>
                    <InlineStack gap="300" blockAlign="end">
                      <Box minWidth="240px">
                        <TextField
                          label={t("billing_discount_field")}
                          value={discountCode}
                          onChange={setDiscountCode}
                          placeholder="ex: LAUNCH20"
                          autoComplete="off"
                        />
                      </Box>
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">{t("billing_discount_help")}</Text>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        )}

        {/* ── Gift code (lifetime, no Shopify charge) — only for trial users ── */}
        {!isActive && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="semibold">{t("billing_gift_title")}</Text>
                <Text variant="bodySm" tone="subdued">
                  {t("billing_gift_desc")}
                </Text>
                <Divider />
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="240px">
                    <TextField
                      label={t("billing_gift_field")}
                      value={giftCode}
                      onChange={setGiftCode}
                      placeholder="ex: EARLYBIRD2026"
                      autoComplete="off"
                    />
                  </Box>
                  <Box paddingBlockEnd="050">
                    <Button
                      variant="primary"
                      onClick={handleGift}
                      loading={isSubmitting && !selectedPlan}
                      disabled={!giftCode.trim()}
                    >
                      {t("billing_gift_activate")}
                    </Button>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ── Lifetime — no plan switching needed ── */}
        {isLifetime && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="semibold">{t("billing_manage_title")}</Text>
                <Text variant="bodySm" tone="subdued">
                  {t("billing_lifetime_manage_desc")}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
