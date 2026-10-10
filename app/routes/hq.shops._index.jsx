// app/routes/hq.shops._index.jsx — every store that installed Picklo
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { Page, Card, IndexTable, Badge, Text, TextField, Button, Box, InlineStack } from "@shopify/polaris";
import { requireTeam } from "../services/hq-auth.server.js";
import { listShops } from "../services/hq-actions.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

export async function loader({ request }) {
  await requireTeam(request);
  const q = new URL(request.url).searchParams.get("q") || "";
  return json({ shops: await listShops({ search: q }), q });
}

export default function Shops() {
  const { shops, q } = useLoaderData();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(q);
  return (
    <Page title="Magazine" subtitle={`${shops.filter((s) => s.installed).length} instalate · ${shops.length} în total`} fullWidth>
      <Card padding="0">
        <Box padding="300">
          <InlineStack gap="200" wrap={false}>
            <Box width="100%"><TextField label="Caută" labelHidden placeholder="nume-magazin.myshopify.com" value={search} onChange={setSearch} autoComplete="off" /></Box>
            <Button onClick={() => { search ? params.set("q", search) : params.delete("q"); setParams(params); }}>Caută</Button>
          </InlineStack>
        </Box>
        <IndexTable
          resourceName={{ singular: "magazin", plural: "magazine" }}
          itemCount={shops.length}
          selectable={false}
          headings={[{ title: "Magazin" }, { title: "Stare" }, { title: "Plan" }, { title: "Curieri" }, { title: "Checkout" }, { title: "Comenzi 30 zile" }, { title: "Tichete" }, { title: "Instalat" }]}
        >
          {shops.map((s, i) => (
            <IndexTable.Row id={s.shop} key={s.shop} position={i}>
              <IndexTable.Cell><Button variant="plain" url={`/hq/shops/${s.shop}`}>{s.shop.replace(".myshopify.com", "")}</Button></IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack gap="100">
                  {s.installed ? <Badge tone="success">activ</Badge> : <Badge>dezinstalat</Badge>}
                  {!s.supportAccess && <Badge tone="warning">fără acces suport</Badge>}
                  {!s.onboardingCompleted && s.installed && <Badge tone="attention">ghid neterminat</Badge>}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>{s.plan}</IndexTable.Cell>
              <IndexTable.Cell><Text tone="subdued">{s.couriers.map((c) => COURIER_LABELS[c]?.name || c).join(", ") || "—"}</Text></IndexTable.Cell>
              <IndexTable.Cell>{s.checkoutMode || "—"}</IndexTable.Cell>
              <IndexTable.Cell>{s.orders30}</IndexTable.Cell>
              <IndexTable.Cell>{s.openTickets ? <Badge tone="attention">{String(s.openTickets)}</Badge> : "—"}</IndexTable.Cell>
              <IndexTable.Cell><Text tone="subdued">{new Date(s.createdAt).toLocaleDateString("ro-RO")}</Text></IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
