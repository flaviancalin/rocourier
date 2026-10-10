// app/routes/app.help.jsx — merchant support: ask the Picklo team, follow the replies
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, TextField, Select, Banner, Checkbox, Divider, Box, Collapsible } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { createTicket, merchantReply, merchantTickets, markReadByMerchant } from "../services/support.server.js";
import { CATEGORIES, STATUSES } from "../utils/support.js";
import { logActivity } from "../services/activity.server.js";

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const [tickets, settings] = await Promise.all([
    merchantTickets(session.shop),
    prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { supportAccess: true } }),
  ]);
  let contact = { name: "", email: "" };
  try {
    const res = await admin.graphql(`{ shop { name email contactEmail } }`);
    const s = (await res.json()).data?.shop;
    contact = { name: s?.name || "", email: s?.contactEmail || s?.email || "" };
  } catch (_) {}
  return json({ tickets, supportAccess: settings?.supportAccess !== false, contact });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const user = session.onlineAccessInfo?.associated_user;
  const who = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email : null;
  try {
    switch (form.get("intent")) {
      case "create": {
        const t = await createTicket(session.shop, {
          subject: form.get("subject"), category: form.get("category"), body: form.get("body"),
          contactName: form.get("contactName") || who, contactEmail: form.get("contactEmail") || user?.email,
        });
        return json({ ok: "Am primit mesajul. Îți răspundem aici, de obicei în aceeași zi lucrătoare.", openId: t.id });
      }
      case "reply":
        await merchantReply(session.shop, form.get("id"), form.get("body"), who);
        return json({ ok: "Mesaj trimis.", openId: form.get("id") });
      case "read":
        await markReadByMerchant(session.shop, form.get("id"));
        return json({});
      case "access": {
        const on = form.get("value") === "true";
        await prisma.shopSettings.update({ where: { shop: session.shop }, data: { supportAccess: on } });
        await logActivity({ shop: session.shop, action: "support_access", actor: user?.email || "merchant", message: on ? "Acces pentru echipa Picklo pornit" : "Acces pentru echipa Picklo oprit" });
        return json({ ok: on ? "Echipa Picklo te poate ajuta direct în configurarea ta." : "Accesul echipei Picklo e oprit." });
      }
      default:
        return json({ error: "Acțiune necunoscută" }, { status: 400 });
    }
  } catch (e) {
    return json({ error: e.message });
  }
}

const fmt = (d) => new Date(d).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Help() {
  const { tickets, supportAccess, contact } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [form, setForm] = useState({ subject: "", category: "question", body: "", contactName: contact.name, contactEmail: contact.email });
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState("");

  useEffect(() => {
    if (actionData?.ok) { setForm((f) => ({ ...f, subject: "", body: "" })); setReply(""); }
    if (actionData?.openId) setOpen(actionData.openId);
  }, [actionData]);

  const toggle = (t) => {
    const next = open === t.id ? null : t.id;
    setOpen(next);
    if (next && t.unreadByMerchant) submit({ intent: "read", id: t.id }, { method: "post" });
  };

  return (
    <Page title="Ajutor" subtitle="Scrie-ne orice întrebare sau problemă — îți răspunde echipa Picklo, aici în aplicație">
      <Layout>
        {actionData?.error && <Layout.Section><Banner tone="critical">{actionData.error}</Banner></Layout.Section>}
        {actionData?.ok && <Layout.Section><Banner tone="success">{actionData.ok}</Banner></Layout.Section>}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Mesaj nou</Text>
              <InlineStack gap="300" wrap>
                <Box minWidth="260px"><Select label="Despre ce e vorba?" value={form.category} onChange={(v) => setForm({ ...form, category: v })}
                  options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} /></Box>
                <Box minWidth="320px"><TextField label="Subiect" value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} autoComplete="off" placeholder="ex: Nu apare easybox în checkout" /></Box>
              </InlineStack>
              <TextField label="Detalii" value={form.body} onChange={(v) => setForm({ ...form, body: v })} multiline={5} autoComplete="off"
                helpText="Numărul comenzii și ce ai încercat ne ajută să răspundem mai repede." />
              <InlineStack gap="300" wrap>
                <TextField label="Numele tău" value={form.contactName} onChange={(v) => setForm({ ...form, contactName: v })} autoComplete="name" />
                <TextField label="Email pentru răspuns" type="email" value={form.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} autoComplete="email" />
              </InlineStack>
              <InlineStack><Button variant="primary" loading={busy} disabled={!form.subject.trim() || form.body.trim().length < 5}
                onClick={() => submit({ intent: "create", ...form }, { method: "post" })}>Trimite</Button></InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Conversațiile tale</Text>
              {tickets.length === 0 ? <Text tone="subdued">Nu ai trimis încă niciun mesaj.</Text> : tickets.map((t) => (
                <BlockStack key={t.id} gap="200">
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="200" blockAlign="center">
                      {t.unreadByMerchant && <Badge tone="info">răspuns nou</Badge>}
                      <Button variant="plain" onClick={() => toggle(t)}>{t.subject}</Button>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Badge tone={t.status === "resolved" ? "success" : undefined}>{t.status === "waiting_merchant" ? "Ți-am răspuns" : STATUSES[t.status]}</Badge>
                      <Text tone="subdued">{fmt(t.lastMessageAt)}</Text>
                    </InlineStack>
                  </InlineStack>
                  <Collapsible open={open === t.id} id={`t-${t.id}`}>
                    <BlockStack gap="200">
                      {t.messages.map((m) => (
                        <Box key={m.id} padding="300" borderRadius="200" background={m.author === "team" ? "bg-surface-secondary" : "bg-surface"} borderWidth="025" borderColor="border">
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">{m.author === "team" ? `${m.authorName || "Echipa Picklo"} · Picklo` : m.authorName || "Tu"} · {fmt(m.createdAt)}</Text>
                            <Text as="p"><span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span></Text>
                          </BlockStack>
                        </Box>
                      ))}
                      <TextField label="Răspunde" labelHidden placeholder="Scrie un răspuns…" value={open === t.id ? reply : ""} onChange={setReply} multiline={3} autoComplete="off" />
                      <InlineStack><Button loading={busy} disabled={!reply.trim()} onClick={() => submit({ intent: "reply", id: t.id, body: reply }, { method: "post" })}>Trimite răspunsul</Button></InlineStack>
                    </BlockStack>
                  </Collapsible>
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd">Acces pentru echipa Picklo</Text>
              <Checkbox label="Permite echipei Picklo să vadă și să ajusteze configurarea Picklo a magazinului" checked={supportAccess}
                onChange={(v) => submit({ intent: "access", value: String(v) }, { method: "post" })} />
              <Text tone="subdued" variant="bodySm">Ne ajută să rezolvăm repede: verificăm curierii, checkout-ul și comenzile, refacem configurarea. Nu vedem parolele curierilor sau ale facturării. Fiecare acțiune apare în istoricul magazinului (Rapoarte).</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
