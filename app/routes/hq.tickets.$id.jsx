// app/routes/hq.tickets.$id.jsx — one ticket: conversation, reply, internal notes, status, assignment
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, TextField, Select, Banner, Box, Divider, Checkbox } from "@shopify/polaris";
import { requireTeam } from "../services/hq-auth.server.js";
import { prisma } from "../db.server.js";
import { teamReply } from "../services/support.server.js";
import { CATEGORIES, STATUSES } from "../utils/support.js";
import { logActivity } from "../services/activity.server.js";

export async function loader({ request, params }) {
  await requireTeam(request);
  const ticket = await prisma.supportTicket.findUnique({ where: { id: params.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) throw new Response("Tichetul nu există", { status: 404 });
  if (ticket.unreadByTeam) await prisma.supportTicket.update({ where: { id: ticket.id }, data: { unreadByTeam: false } });
  const [team, settings, otherTickets] = await Promise.all([
    prisma.teamMember.findMany({ where: { active: true }, select: { email: true, name: true } }),
    prisma.shopSettings.findUnique({ where: { shop: ticket.shop }, select: { planType: true, checkoutMode: true, supportAccess: true, onboardingCompleted: true } }),
    prisma.supportTicket.findMany({ where: { shop: ticket.shop, id: { not: ticket.id } }, orderBy: { lastMessageAt: "desc" }, take: 5, select: { id: true, subject: true, status: true } }),
  ]);
  return json({ ticket, team, settings, otherTickets });
}

export async function action({ request, params }) {
  const member = await requireTeam(request);
  const form = await request.formData();
  const ticket = await prisma.supportTicket.findUnique({ where: { id: params.id } });
  if (!ticket) return json({ error: "Tichetul nu există" }, { status: 404 });
  try {
    switch (form.get("intent")) {
      case "reply": {
        const internal = form.get("internal") === "true";
        const status = form.get("status") || null;
        await teamReply(ticket.id, member, form.get("body"), { internal, status: internal ? null : status });
        if (!internal) await logActivity({ shop: ticket.shop, action: "support_reply", actor: `suport:${member.email}`, message: `Răspuns la tichetul „${ticket.subject}”` });
        return json({ ok: internal ? "Notă internă salvată" : "Răspuns trimis — clientul îl vede în Picklo → Ajutor" });
      }
      case "meta": {
        const data = {};
        if (form.has("status") && STATUSES[form.get("status")]) data.status = form.get("status");
        if (form.has("priority") && ["low", "normal", "high", "urgent"].includes(form.get("priority"))) data.priority = form.get("priority");
        if (form.has("assignedTo")) data.assignedTo = form.get("assignedTo") || null;
        await prisma.supportTicket.update({ where: { id: ticket.id }, data });
        return json({ ok: "Tichet actualizat" });
      }
      default:
        return json({ error: "Acțiune necunoscută" }, { status: 400 });
    }
  } catch (e) {
    return json({ error: e.message });
  }
}

const fmt = (d) => new Date(d).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Ticket() {
  const { ticket: t, team, settings, otherTickets } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState("waiting_merchant");
  const busy = nav.state !== "idle";

  useEffect(() => { if (actionData?.ok) setBody(""); }, [actionData]);
  const meta = (patch) => submit({ intent: "meta", ...patch }, { method: "post" });

  return (
    <Page
      backAction={{ url: "/hq/tickets" }}
      title={t.subject}
      subtitle={`${t.shop} · ${CATEGORIES[t.category]} · deschis ${fmt(t.createdAt)}`}
      titleMetadata={<Badge tone={t.status === "resolved" ? "success" : "attention"}>{STATUSES[t.status]}</Badge>}
      secondaryActions={[{ content: "Deschide magazinul în HQ", url: `/hq/shops/${t.shop}` }]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
            {actionData?.ok && <Banner tone="success">{actionData.ok}</Banner>}
            {t.messages.map((m) => (
              <Card key={m.id} background={m.internal ? "bg-surface-warning" : m.author === "team" ? "bg-surface-secondary" : undefined}>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text fontWeight="semibold">{m.author === "team" ? `${m.authorName || "Echipa Picklo"} (echipă)` : m.authorName || "Client"}{m.internal ? " · notă internă" : ""}</Text>
                    <Text tone="subdued">{fmt(m.createdAt)}</Text>
                  </InlineStack>
                  <Text as="p"><span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span></Text>
                </BlockStack>
              </Card>
            ))}
            <Card>
              <BlockStack gap="300">
                <TextField label={internal ? "Notă internă (clientul nu o vede)" : "Răspuns către client"} value={body} onChange={setBody} multiline={5} autoComplete="off" />
                <InlineStack gap="400" blockAlign="center" wrap>
                  <Checkbox label="Notă internă" checked={internal} onChange={setInternal} />
                  {!internal && (
                    <Box minWidth="240px">
                      <Select label="După trimitere" labelInline value={after} onChange={setAfter}
                        options={[{ label: "Așteaptă clientul", value: "waiting_merchant" }, { label: "Rezolvat", value: "resolved" }, { label: "Rămâne deschis", value: "open" }]} />
                    </Box>
                  )}
                  <Button variant="primary" loading={busy} disabled={!body.trim()}
                    onClick={() => submit({ intent: "reply", body, internal: String(internal), status: after }, { method: "post" })}>
                    {internal ? "Salvează nota" : "Trimite răspunsul"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Select label="Status" value={t.status} onChange={(v) => meta({ status: v })} options={Object.entries(STATUSES).map(([value, label]) => ({ value, label }))} />
                <Select label="Prioritate" value={t.priority} onChange={(v) => meta({ priority: v })}
                  options={[{ label: "Scăzută", value: "low" }, { label: "Normală", value: "normal" }, { label: "Ridicată", value: "high" }, { label: "Urgentă", value: "urgent" }]} />
                <Select label="Asignat" value={t.assignedTo || ""} onChange={(v) => meta({ assignedTo: v })}
                  options={[{ label: "Nimeni", value: "" }, ...team.map((m) => ({ label: m.name, value: m.email }))]} />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm">Client</Text>
                <Text>{t.contactName || "—"}</Text>
                <Text tone="subdued">{t.contactEmail || "fără email"}</Text>
                <Divider />
                <Text>Plan: {settings?.planType || "—"} · Checkout: {settings?.checkoutMode || "neconfigurat"}</Text>
                <Text>Ghid configurare: {settings?.onboardingCompleted ? "terminat" : "neterminat"}</Text>
                {settings && !settings.supportAccess && <Banner tone="warning">Clientul a oprit accesul echipei de suport la magazin.</Banner>}
              </BlockStack>
            </Card>
            {otherTickets.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm">Alte tichete ale magazinului</Text>
                  {otherTickets.map((o) => <Button key={o.id} variant="plain" url={`/hq/tickets/${o.id}`}>{`${o.subject} (${STATUSES[o.status]})`}</Button>)}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
