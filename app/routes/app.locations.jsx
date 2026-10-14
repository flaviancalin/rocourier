// app/routes/app.locations.jsx — ship from several places: warehouses, shops, dropshipping
// suppliers. Locations come from Shopify; each has its own sender details for the AWB.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Checkbox, Button, Banner, Badge, Select, Divider, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { importShopifyLocations, listShipLocations } from "../services/ship-locations.server.js";
import { samedayGetClientPickupPoints } from "../services/sameday.server.js";
import { cargusGetSenderLocations } from "../services/cargus.server.js";

const EDITABLE = ["name", "contactName", "phone", "email", "address", "city", "county", "zip", "samedayPickupPointId", "cargusLocationId"];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const [settings, locations] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop: session.shop }, select: { multiLocationEnabled: true, samedayEnabled: true, cargusEnabled: true } }),
    listShipLocations(session.shop),
  ]);
  return json({ settings: settings || {}, locations });
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const shop = session.shop;
  try {
    switch (form.get("intent")) {
      case "toggle": {
        const on = form.get("value") === "true";
        await prisma.shopSettings.update({ where: { shop }, data: { multiLocationEnabled: on } });
        if (on && !(await prisma.shipLocation.count({ where: { shop } }))) await importShopifyLocations(admin, shop);
        return json({ ok: on ? "Expedierea din mai multe locații e pornită" : "Expedierea din mai multe locații e oprită" });
      }
      case "import": {
        const r = await importShopifyLocations(admin, shop);
        return json({ ok: `${r.count} locații din Shopify` });
      }
      case "save": {
        const id = form.get("id");
        const loc = await prisma.shipLocation.findFirst({ where: { id, shop } });
        if (!loc) return json({ error: "Locația nu există" }, { status: 404 });
        const data = Object.fromEntries(EDITABLE.map((k) => [k, String(form.get(k) ?? "").trim() || null]));
        if (!data.name) data.name = loc.name;
        data.isSupplier = form.get("isSupplier") === "true";
        data.active = form.get("active") !== "false";
        await prisma.shipLocation.update({ where: { id }, data });
        return json({ ok: `${data.name}: salvat` });
      }
      case "courier-senders": {
        // Pickup points / locations of the courier accounts, to tie them to each location
        const s = await prisma.shopSettings.findUnique({ where: { shop } });
        const out = { sameday: [], cargus: [] };
        if (s?.samedayEnabled && s.samedayUsername) {
          try { out.sameday = (await samedayGetClientPickupPoints({ username: s.samedayUsername, password: s.samedayPassword, sandbox: !!s.samedaySandbox }))
            .map((p) => ({ value: String(p.id), label: [p.alias || p.name, p.address, p.city?.name || p.city].filter(Boolean).join(", ") })); } catch (e) { out.samedayError = e.message; }
        }
        if (s?.cargusEnabled && s.cargusSubscriptionKey) {
          try { out.cargus = (await cargusGetSenderLocations({ subscriptionKey: s.cargusSubscriptionKey, username: s.cargusUsername, password: s.cargusPassword }))
            .slice(0, 300).map((l) => ({ value: String(l.LocationId ?? l.locationId), label: [l.Name, l.LocalityName, l.AddressText || l.StreetName].filter(Boolean).join(", ") })); } catch (e) { out.cargusError = e.message; }
        }
        return json({ senders: out });
      }
      default:
        return json({ error: "Acțiune necunoscută" }, { status: 400 });
    }
  } catch (e) {
    const scope = /access|scope|permission/i.test(e.message || "");
    return json({ error: scope ? "Aplicația are nevoie de permisiunea de a citi locațiile. Aprobă permisiunile noi ale aplicației din Shopify." : e.message });
  }
}

function LocationCard({ loc, senders, submit, busy }) {
  const [f, setF] = useState(() => ({ ...Object.fromEntries(EDITABLE.map((k) => [k, loc[k] || ""])), isSupplier: loc.isSupplier, active: loc.active }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const opts = (list, empty) => [{ label: empty, value: "" }, ...(list || [])];
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingMd">{loc.name}</Text>
            {f.isSupplier && <Badge tone="info">Furnizor</Badge>}
            {!f.active && <Badge>Nefolosită</Badge>}
          </InlineStack>
          <Button variant="primary" loading={busy} onClick={() => submit({ intent: "save", id: loc.id, ...f, isSupplier: String(f.isSupplier), active: String(f.active) }, { method: "post" })}>Salvează</Button>
        </InlineStack>
        <InlineStack gap="300" wrap>
          <TextField label="Nume pe AWB (expeditor)" value={f.name} onChange={set("name")} autoComplete="off" />
          <TextField label="Persoană de contact" value={f.contactName} onChange={set("contactName")} autoComplete="off" />
          <TextField label="Telefon" value={f.phone} onChange={set("phone")} autoComplete="off" />
          <TextField label="Email" value={f.email} onChange={set("email")} autoComplete="off" />
        </InlineStack>
        <InlineStack gap="300" wrap>
          <TextField label="Adresă" value={f.address} onChange={set("address")} autoComplete="off" />
          <TextField label="Localitate" value={f.city} onChange={set("city")} autoComplete="off" />
          <TextField label="Județ" value={f.county} onChange={set("county")} autoComplete="off" />
          <TextField label="Cod poștal" value={f.zip} onChange={set("zip")} autoComplete="off" />
        </InlineStack>
        {(senders?.sameday?.length > 0 || senders?.cargus?.length > 0) && (
          <InlineStack gap="300" wrap>
            {senders.sameday?.length > 0 && <Select label="Punct de ridicare Sameday" value={f.samedayPickupPointId} onChange={set("samedayPickupPointId")} options={opts(senders.sameday, "Primul din cont")} />}
            {senders.cargus?.length > 0 && <Select label="Locație Cargus" value={f.cargusLocationId} onChange={set("cargusLocationId")} options={opts(senders.cargus, "Prima din cont")} />}
          </InlineStack>
        )}
        <InlineStack gap="400" wrap>
          <Checkbox label="Furnizor (dropshipping): coletul pleacă de la el" checked={f.isSupplier} onChange={set("isSupplier")} />
          <Checkbox label="Folosită pentru AWB-uri" checked={f.active} onChange={set("active")} />
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function Locations() {
  const { settings, locations } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [senders, setSenders] = useState(null);
  useEffect(() => { if (actionData?.senders) setSenders(actionData.senders); }, [actionData]);
  const busyId = nav.state !== "idle" ? nav.formData?.get("id") : null;
  const on = !!settings.multiLocationEnabled;

  return (
    <Page backAction={{ url: "/app/settings" }} title="Locații de expediere"
      subtitle="Depozite, magazine sau furnizori din care pleacă coletele. AWB-ul ia expeditorul din locația care onorează comanda în Shopify.">
      <Layout>
        {actionData?.error && <Layout.Section><Banner tone="critical">{actionData.error}</Banner></Layout.Section>}
        {actionData?.ok && <Layout.Section><Banner tone="success">{actionData.ok}</Banner></Layout.Section>}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="200" blockAlign="center"><Text variant="headingMd">Expediez din mai multe locații</Text><Badge tone={on ? "success" : undefined}>{on ? "Pornit" : "Oprit"}</Badge></InlineStack>
                <Button variant={on ? "secondary" : "primary"} loading={nav.state !== "idle" && nav.formData?.get("intent") === "toggle"}
                  onClick={() => submit({ intent: "toggle", value: String(!on) }, { method: "post" })}>{on ? "Oprește" : "Pornește"}</Button>
              </InlineStack>
              <Text tone="subdued">Când e pornit, la generarea AWB-ului Picklo alege locația din care Shopify onorează comanda (Setări Shopify → Locații) și o folosește ca expeditor. O poți schimba din fereastra de AWB. Pentru dropshipping, adaugă furnizorul ca locație în Shopify, cu produsele lui.</Text>
              {on && (
                <InlineStack gap="200">
                  <Button onClick={() => submit({ intent: "import" }, { method: "post" })} loading={nav.state !== "idle" && nav.formData?.get("intent") === "import"}>Actualizează din Shopify</Button>
                  <Button onClick={() => submit({ intent: "courier-senders" }, { method: "post" })} loading={nav.state !== "idle" && nav.formData?.get("intent") === "courier-senders"}>Leagă de punctele Sameday / Cargus</Button>
                </InlineStack>
              )}
              {senders?.samedayError && <Text tone="critical">{`Sameday: ${senders.samedayError}`}</Text>}
              {senders?.cargusError && <Text tone="critical">{`Cargus: ${senders.cargusError}`}</Text>}
              <Text tone="subdued" variant="bodySm">Sameday și Cargus ridică doar de la adresele înregistrate în contul tău de curier, așa că fiecare locație se leagă de un punct de ridicare din cont. FAN, GLS, DPD și Packeta folosesc adresa locației direct.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        {on && (
          <Layout.Section>
            <BlockStack gap="300">
              {locations.length === 0
                ? <Card><EmptyState heading="Nicio locație încă" image=""><Text>Apasă „Actualizează din Shopify”.</Text></EmptyState></Card>
                : locations.map((l) => <LocationCard key={l.id} loc={l} senders={senders} submit={submit} busy={busyId === l.id} />)}
            </BlockStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
