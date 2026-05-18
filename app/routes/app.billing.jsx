// app/routes/app.billing.jsx
// Plan management & billing page
import { useState, useEffect, useCallback } from "react";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button,
  Banner, Divider, TextField, ProgressBar, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const TRIAL_LIMIT   = 10;
const APP_URL       = process.env.SHOPIFY_APP_URL || "https://rocourier-production.up.railway.app";
const RETURN_URL    = `${APP_URL}/app/billing`;
// Use test mode in non-production environments so Shopify reviewers can test billing
const BILLING_TEST  = process.env.NODE_ENV !== "production";

const PLANS = {
  monthly:  { name: "Pro Monthly",  price: 19.00,  interval: "EVERY_30_DAYS", label: "$19 / lună",  badge: null },
  yearly:   { name: "Pro Yearly",   price: 149.00, interval: "ANNUAL",        label: "$149 / an",   badge: "Economisești 35%" },
  lifetime: { name: "Pro Lifetime", price: 299.00, interval: null,            label: "$299 o dată", badge: "Plată unică" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Loader — also handles Shopify billing callback (?charge_id=...)
// ─────────────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const url    = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  // Shopify billing return — verify and activate plan
  if (chargeId) {
    const isOneTime = chargeId.includes("AppPurchaseOneTime");
    const query = isOneTime
      ? `query { node(id: "${chargeId}") { ... on AppPurchaseOneTime { id status name } } }`
      : `query { node(id: "${chargeId}") { ... on AppSubscription { id status name } } }`;

    let planType = null;
    try {
      const res  = await admin.graphql(query);
      const body = await res.json();
      const node = body?.data?.node;
      const status = node?.status;
      const name   = node?.name || "";

      if (status === "ACTIVE" || status === "ACCEPTED") {
        if (isOneTime)             planType = "lifetime";
        else if (name.includes("Yearly"))  planType = "pro_yearly";
        else                               planType = "pro_monthly";

        await prisma.shopSettings.update({
          where: { shop },
          data: {
            planType,
            shopifyChargeId:  chargeId,
            planActivatedAt:  new Date(),
          },
        });
      }
    } catch (e) {
      console.error("[Billing] charge verification error:", e.message);
    }

    // Strip charge_id from URL to avoid re-processing on refresh
    return redirect("/app/billing?activated=1");
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const activated = url.searchParams.get("activated") === "1";

  return json({
    shop,
    planType:    settings?.planType    || "trial",
    awbCount:    settings?.awbCount    || 0,
    chargeId:    settings?.shopifyChargeId || null,
    activatedAt: settings?.planActivatedAt || null,
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

    // Check if this shop already used this code
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
    const plan         = formData.get("plan");    // "monthly" | "yearly" | "lifetime"
    const discountCode = String(formData.get("discountCode") || "").trim().toUpperCase();

    const planConfig = PLANS[plan];
    if (!planConfig) return json({ error: "Plan invalid." });

    let price = planConfig.price;

    // Validate % discount code
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

      // Mark discount code as used immediately (before Shopify charge)
      await prisma.$transaction([
        prisma.discountCode.update({ where: { code: discountCode }, data: { usedCount: { increment: 1 } } }),
        prisma.discountCodeUsage.create({ data: { code: discountCode, shop } }),
      ]);
    }

    const returnUrl = `${RETURN_URL}?t=${Date.now()}`;

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
function PlanCard({ plan, planKey, current, onSelect, loading }) {
  const isCurrent = current === planKey ||
    (planKey === "monthly" && current === "pro_monthly") ||
    (planKey === "yearly"  && current === "pro_yearly")  ||
    (planKey === "lifetime" && current === "lifetime");

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingMd" fontWeight="semibold">{plan.label}</Text>
            {plan.badge && <Badge tone="success">{plan.badge}</Badge>}
          </BlockStack>
          {isCurrent && <Badge tone="success">Plan activ</Badge>}
        </InlineStack>
        <Text variant="bodySm" tone="subdued">
          {planKey === "monthly"  && "Acces nelimitat la generarea AWB-urilor, toate curierele suportate."}
          {planKey === "yearly"   && "Totul din planul lunar, cu 35% reducere. Ideal pentru volume mari."}
          {planKey === "lifetime" && "Plătești o singură dată, accesi aplicația pentru totdeauna. Fără abonament."}
        </Text>
        {!isCurrent && (
          <Button variant="primary" onClick={() => onSelect(planKey)} loading={loading} fullWidth>
            {planKey === "lifetime" ? "Cumpără licența" : "Abonează-te"}
          </Button>
        )}
        {isCurrent && (
          <Button disabled fullWidth>Plan activ</Button>
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
  const isSubmitting = navigation.state === "submitting";

  const [giftCode,      setGiftCode]      = useState("");
  const [discountCode,  setDiscountCode]  = useState("");
  const [selectedPlan,  setSelectedPlan]  = useState(null);
  const [toast,         setToast]         = useState(null);

  // Redirect to Shopify billing confirmation URL
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData]);

  useEffect(() => {
    if (activated) setToast("Plan activat cu succes!");
    if (actionData?.giftActivated) setToast("Cod activat! Ai acces lifetime.");
  }, [activated, actionData]);

  const isActive   = planType !== "trial";
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
      title="Plan & Facturare"
      subtitle="Gestionează subscripția aplicației Picklo"
    >
      {toast && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success" onDismiss={() => setToast(null)}>{toast}</Banner>
        </div>
      )}
      {actionData?.error && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="critical" title="Eroare">{actionData.error}</Banner>
        </div>
      )}

      <Layout>
        {/* ── Current plan status ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="semibold">Planul tău curent</Text>
                {planType === "trial"    && <Badge tone="warning">Trial</Badge>}
                {planType === "pro_monthly" && <Badge tone="success">Pro Monthly</Badge>}
                {planType === "pro_yearly"  && <Badge tone="success">Pro Yearly</Badge>}
                {planType === "lifetime"    && <Badge tone="success">Lifetime</Badge>}
              </InlineStack>

              {planType === "trial" && (
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm">AWB-uri folosite în trial</Text>
                    <Text variant="bodySm" fontWeight="semibold">{awbCount} / {TRIAL_LIMIT}</Text>
                  </InlineStack>
                  <ProgressBar progress={trialPct} tone={trialLeft === 0 ? "critical" : trialLeft <= 3 ? "warning" : "highlight"} />
                  {trialLeft === 0 && (
                    <Banner tone="critical" title="Trial expirat">
                      Ai generat cele {TRIAL_LIMIT} AWB-uri gratuite. Alege un plan de mai jos pentru a continua.
                    </Banner>
                  )}
                  {trialLeft > 0 && trialLeft <= 3 && (
                    <Banner tone="warning">
                      Îți mai rămân <strong>{trialLeft} AWB-uri</strong> gratuite. Activează un plan înainte să rămâi fără.
                    </Banner>
                  )}
                  {trialLeft > 3 && (
                    <Text variant="bodySm" tone="subdued">Îți mai rămân {trialLeft} AWB-uri gratuite.</Text>
                  )}
                </BlockStack>
              )}

              {isActive && (
                <Banner tone="success">
                  Contul tău este activ. Poți genera AWB-uri nelimitat.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Plan cards ── */}
        {!isActive && (
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Alege un plan</Text>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                {Object.entries(PLANS).map(([key, plan]) => (
                  <PlanCard
                    key={key}
                    planKey={key}
                    plan={plan}
                    current={planType}
                    onSelect={handleSubscribe}
                    loading={isSubmitting && selectedPlan === key}
                  />
                ))}
              </InlineGrid>

              {/* Discount code for paid plans */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="semibold">Cod de reducere</Text>
                  <Text variant="bodySm" tone="subdued">Dacă ai un cod promoțional, introdu-l înainte de a te abona.</Text>
                  <InlineStack gap="300" blockAlign="end">
                    <Box minWidth="240px">
                      <TextField
                        label="Cod reducere (%)"
                        value={discountCode}
                        onChange={setDiscountCode}
                        placeholder="ex: LAUNCH20"
                        autoComplete="off"
                      />
                    </Box>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued">Codul va fi aplicat automat la apăsarea butonului de abonare.</Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        )}

        {/* ── Gift code (lifetime, no Shopify charge) ── */}
        {!isActive && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="semibold">Cod cadou — Lifetime gratuit</Text>
                <Text variant="bodySm" tone="subdued">
                  Dacă ai primit un cod cadou lifetime, activează-l aici fără nicio plată.
                </Text>
                <Divider />
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="240px">
                    <TextField
                      label="Cod cadou"
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
                      Activează codul
                    </Button>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ── Active plan — manage ── */}
        {isActive && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="semibold">Gestionare subscripție</Text>
                <Text variant="bodySm" tone="subdued">
                  Pentru anulare sau modificare plan, contactează suportul la{" "}
                  <strong>support@picklo.app</strong> sau folosește panoul Shopify Partners.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
