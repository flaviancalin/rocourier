// app/routes/hq._index.jsx — what needs attention right now
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Box, Button } from "@shopify/polaris";
import { requireTeam } from "../services/hq-auth.server.js";
import { prisma } from "../db.server.js";
import { CATEGORIES } from "../utils/support.js";

export async function loader({ request }) {
  await requireTeam(request);
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [open, unread, waiting, shops, newShops, awbs, latest] = await Promise.all([
    prisma.supportTicket.count({ where: { status: "open" } }),
    prisma.supportTicket.count({ where: { unreadByTeam: true, status: { not: "resolved" } } }),
    prisma.supportTicket.count({ where: { status: "waiting_merchant" } }),
    prisma.session.count({ where: { isOnline: false } }),
    prisma.shopSettings.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.order.count({ where: { awbNumber: { not: null }, updatedAt: { gte: weekAgo } } }),
    prisma.supportTicket.findMany({ where: { status: { not: "resolved" } }, orderBy: { lastMessageAt: "desc" }, take: 8 }),
  ]);
  return json({ stats: { open, unread, waiting, shops, newShops, awbs }, latest });
}

const Stat = ({ label, value, tone }) => (
  <Box minWidth="170px"><Card><BlockStack gap="050"><Text tone="subdued">{label}</Text><Text variant="heading2xl" as="p" tone={tone}>{value}</Text></BlockStack></Card></Box>
);

export default function HqHome() {
  const { stats: s, latest } = useLoaderData();
  return (
    <Page title="Acasă">
      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Stat label="Tichete necitite" value={s.unread} tone={s.unread ? "critical" : undefined} />
            <Stat label="Tichete deschise" value={s.open} />
            <Stat label="Așteaptă clientul" value={s.waiting} />
            <Stat label="Magazine instalate" value={s.shops} />
            <Stat label="Instalări noi (7 zile)" value={s.newShops} />
            <Stat label="AWB-uri (7 zile)" value={s.awbs} />
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between"><Text variant="headingMd">Tichete active</Text><Button url="/hq/tickets">Toate tichetele</Button></InlineStack>
              {latest.length === 0 ? <Text tone="subdued">Niciun tichet deschis.</Text> : latest.map((t) => (
                <InlineStack key={t.id} align="space-between" blockAlign="center" wrap={false}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    {t.unreadByTeam && <Badge tone="critical">nou</Badge>}
                    <Button variant="plain" url={`/hq/tickets/${t.id}`}>{t.subject}</Button>
                    <Text tone="subdued">{t.shop} · {CATEGORIES[t.category]}</Text>
                  </InlineStack>
                  <Text tone="subdued">{new Date(t.lastMessageAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
