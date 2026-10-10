// app/routes/hq.tickets._index.jsx — all support tickets, newest activity first
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Card, IndexTable, Badge, Text, Tabs, Button, TextField, Box, InlineStack } from "@shopify/polaris";
import { useState } from "react";
import { requireTeam } from "../services/hq-auth.server.js";
import { prisma } from "../db.server.js";
import { CATEGORIES, STATUSES } from "../utils/support.js";

const VIEWS = [
  { id: "active", content: "Active", where: { status: { not: "resolved" } } },
  { id: "unread", content: "Necitite", where: { unreadByTeam: true, status: { not: "resolved" } } },
  { id: "mine", content: "Ale mele", where: null },
  { id: "resolved", content: "Rezolvate", where: { status: "resolved" } },
];
const PRIORITY_TONE = { urgent: "critical", high: "warning", normal: undefined, low: undefined };

export async function loader({ request }) {
  const member = await requireTeam(request);
  const url = new URL(request.url);
  const view = VIEWS.find((v) => v.id === url.searchParams.get("view")) || VIEWS[0];
  const q = url.searchParams.get("q") || "";
  const where = {
    ...(view.id === "mine" ? { assignedTo: member.email, status: { not: "resolved" } } : view.where),
    ...(q ? { OR: [{ shop: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }, { contactEmail: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const tickets = await prisma.supportTicket.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 200 });
  return json({ tickets, view: view.id, q });
}

export default function Tickets() {
  const { tickets, view, q } = useLoaderData();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(q);
  const go = (patch) => { for (const [k, v] of Object.entries(patch)) v ? params.set(k, v) : params.delete(k); setParams(params); };

  return (
    <Page title="Tichete" fullWidth>
      <Card padding="0">
        <Tabs tabs={VIEWS} selected={Math.max(0, VIEWS.findIndex((v) => v.id === view))} onSelect={(i) => go({ view: VIEWS[i].id })} />
        <Box padding="300">
          <InlineStack gap="200" wrap={false}>
            <Box width="100%"><TextField label="Caută" labelHidden placeholder="Magazin, subiect sau email" value={search} onChange={setSearch} autoComplete="off" /></Box>
            <Button onClick={() => go({ q: search })}>Caută</Button>
          </InlineStack>
        </Box>
        <IndexTable
          resourceName={{ singular: "tichet", plural: "tichete" }}
          itemCount={tickets.length}
          selectable={false}
          headings={[{ title: "Subiect" }, { title: "Magazin" }, { title: "Categorie" }, { title: "Status" }, { title: "Prioritate" }, { title: "Asignat" }, { title: "Ultimul mesaj" }]}
        >
          {tickets.map((t, i) => (
            <IndexTable.Row id={t.id} key={t.id} position={i}>
              <IndexTable.Cell>
                <InlineStack gap="200" wrap={false}>
                  {t.unreadByTeam && <Badge tone="critical">nou</Badge>}
                  <Button variant="plain" url={`/hq/tickets/${t.id}`}>{t.subject}</Button>
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell><Button variant="plain" url={`/hq/shops/${t.shop}`}>{t.shop.replace(".myshopify.com", "")}</Button></IndexTable.Cell>
              <IndexTable.Cell>{CATEGORIES[t.category]}</IndexTable.Cell>
              <IndexTable.Cell><Badge tone={t.status === "resolved" ? "success" : t.status === "open" ? "attention" : "info"}>{STATUSES[t.status]}</Badge></IndexTable.Cell>
              <IndexTable.Cell>{t.priority === "normal" ? "—" : <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>}</IndexTable.Cell>
              <IndexTable.Cell><Text tone="subdued">{t.assignedTo || "—"}</Text></IndexTable.Cell>
              <IndexTable.Cell><Text tone="subdued">{new Date(t.lastMessageAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Text></IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
