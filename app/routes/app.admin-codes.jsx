// app/routes/app.admin-codes.jsx
// Admin-only page for creating and managing discount codes.
// Protected: only accessible from the ADMIN_SHOP store (set via env var).
import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button,
  TextField, Select, Banner, DataTable, Divider, Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";

const ADMIN_SHOP = process.env.ADMIN_SHOP || "courier-store-2.myshopify.com";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  if (shop !== ADMIN_SHOP) {
    return json({ unauthorized: true, codes: [] });
  }

  const codes = await prisma.discountCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { usages: { select: { shop: true, usedAt: true } } },
  });

  return json({ unauthorized: false, codes });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  if (shop !== ADMIN_SHOP) return json({ error: "Unauthorized" }, { status: 403 });

  const formData = await request.formData();
  const intent   = formData.get("intent");

  if (intent === "create") {
    const code       = String(formData.get("code") || "").trim().toUpperCase();
    const type       = formData.get("type");          // "lifetime_gift" | "percent"
    const percentOff = parseInt(formData.get("percentOff") || "0");
    const maxUses    = formData.get("maxUses") ? parseInt(formData.get("maxUses")) : null;

    if (!code) return json({ error: "Codul este obligatoriu." });
    if (type === "percent" && (isNaN(percentOff) || percentOff < 1 || percentOff > 100)) {
      return json({ error: "Procentul trebuie să fie între 1 și 100." });
    }

    try {
      await prisma.discountCode.create({
        data: {
          code,
          type,
          percentOff: type === "percent" ? percentOff : null,
          maxUses,
        },
      });
      return json({ created: true, code });
    } catch (e) {
      if (e.code === "P2002") return json({ error: `Codul "${code}" există deja.` });
      return json({ error: e.message });
    }
  }

  if (intent === "deactivate") {
    const code = formData.get("code");
    await prisma.discountCode.update({ where: { code }, data: { active: false } });
    return json({ deactivated: true });
  }

  if (intent === "activate") {
    const code = formData.get("code");
    await prisma.discountCode.update({ where: { code }, data: { active: true } });
    return json({ activated: true });
  }

  return json({ error: "Intent invalid." });
}

export default function AdminCodesPage() {
  const { unauthorized, codes } = useLoaderData();
  const actionData  = useActionData();
  const submit      = useSubmit();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [newCode,      setNewCode]      = useState("");
  const [codeType,     setCodeType]     = useState("lifetime_gift");
  const [percentOff,   setPercentOff]   = useState("20");
  const [maxUses,      setMaxUses]      = useState("");

  const handleCreate = useCallback(() => {
    submit({ intent: "create", code: newCode, type: codeType, percentOff, maxUses }, { method: "post" });
    setNewCode("");
  }, [submit, newCode, codeType, percentOff, maxUses]);

  const handleToggle = useCallback((code, active) => {
    submit({ intent: active ? "deactivate" : "activate", code }, { method: "post" });
  }, [submit]);

  if (unauthorized) {
    return (
      <Page title="Admin — Coduri discount">
        <Banner tone="critical" title="Acces interzis">
          Această pagină este disponibilă doar pentru administratorul aplicației.
        </Banner>
      </Page>
    );
  }

  const rows = (codes || []).map((dc) => [
    <Text fontWeight="semibold">{dc.code}</Text>,
    dc.type === "lifetime_gift" ? <Badge tone="success">Lifetime cadou</Badge> : <Badge tone="info">{dc.percentOff}% reducere</Badge>,
    dc.maxUses === null ? "Nelimitat" : `${dc.usedCount} / ${dc.maxUses}`,
    dc.active ? <Badge tone="success">Activ</Badge> : <Badge tone="critical">Inactiv</Badge>,
    dc.usages?.length > 0
      ? dc.usages.map((u) => u.shop).join(", ")
      : "—",
    <Button
      size="slim"
      tone={dc.active ? "critical" : undefined}
      onClick={() => handleToggle(dc.code, dc.active)}
      loading={isSubmitting}
    >
      {dc.active ? "Dezactivează" : "Activează"}
    </Button>,
  ]);

  return (
    <Page title="Admin — Coduri discount" subtitle="Gestionare coduri cadou și reduceri">
      {actionData?.created && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success">Codul <strong>{actionData.code}</strong> a fost creat.</Banner>
        </div>
      )}
      {actionData?.error && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="critical">{actionData.error}</Banner>
        </div>
      )}

      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Crează cod nou</Text>
              <Divider />
              <InlineStack gap="400" blockAlign="end" wrap>
                <Box minWidth="180px">
                  <TextField
                    label="Cod"
                    value={newCode}
                    onChange={setNewCode}
                    placeholder="ex: EARLYBIRD2026"
                    helpText="Va fi convertit automat la majuscule."
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="200px">
                  <Select
                    label="Tip cod"
                    value={codeType}
                    onChange={setCodeType}
                    options={[
                      { label: "Lifetime cadou (gratuit)",  value: "lifetime_gift" },
                      { label: "Reducere procentuală (%)",  value: "percent" },
                    ]}
                  />
                </Box>
                {codeType === "percent" && (
                  <Box minWidth="120px">
                    <TextField
                      label="Procent reducere"
                      value={percentOff}
                      onChange={setPercentOff}
                      type="number"
                      min="1"
                      max="100"
                      suffix="%"
                      autoComplete="off"
                    />
                  </Box>
                )}
                <Box minWidth="140px">
                  <TextField
                    label="Utilizări maxime"
                    value={maxUses}
                    onChange={setMaxUses}
                    type="number"
                    min="1"
                    placeholder="Nelimitat"
                    helpText="Lasă gol = nelimitat"
                    autoComplete="off"
                  />
                </Box>
                <Box paddingBlockEnd="050">
                  <Button
                    variant="primary"
                    onClick={handleCreate}
                    loading={isSubmitting}
                    disabled={!newCode.trim()}
                  >
                    Crează codul
                  </Button>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" fontWeight="semibold">Toate codurile ({codes?.length || 0})</Text>
              {codes?.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Cod", "Tip", "Utilizări", "Status", "Folosit de", "Acțiune"]}
                  rows={rows}
                />
              ) : (
                <Text tone="subdued">Nu există coduri create încă.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
