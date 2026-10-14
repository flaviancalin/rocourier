// app/routes/app.whatsapp.jsx — order confirmation on WhatsApp: the buyer taps a button on the
// Thank you page and sends a prefilled message to the merchant's own WhatsApp Business number.
// Works on every Shopify plan except Starter, and costs nothing per message.
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, TextField, Checkbox, Button, Banner, Badge, Box, List, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { syncWhatsappMetafield } from "../services/whatsapp-confirm.server.js";
import { mailConfigured } from "../services/mail.server.js";
import { PICKUP_HOLD_DAYS } from "../services/pickup-reminders.server.js";
import { logActivity } from "../services/activity.server.js";
import { WHATSAPP_DEFAULTS, WHATSAPP_PLACEHOLDERS, normalizeWhatsappPhone, renderWhatsappMessage, whatsappLink } from "../utils/whatsapp-confirm.js";

const FIELDS = ["whatsappConfirm", "whatsappPhone", "whatsappName", "whatsappTitle", "whatsappText", "whatsappButton", "whatsappMessage", "whatsappCodOnly",
  "pickupReminderEnabled", "pickupReminderHours", "pickupReminderLastDay"];

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
    select: Object.fromEntries(FIELDS.map((f) => [f, true])),
  });
  let shopName = "";
  try { shopName = (await (await admin.graphql(`{ shop { name } }`)).json()).data?.shop?.name || ""; } catch (_) {}
  const [confirmed, reminded] = await Promise.all([
    prisma.order.count({ where: { shop: session.shop, customerConfirmedAt: { not: null } } }),
    prisma.order.count({ where: { shop: session.shop, pickupRemindersSent: { gt: 0 } } }),
  ]);
  return json({ settings: settings || {}, shop: session.shop, shopName, confirmed, reminded, mailReady: mailConfigured(), holdDays: PICKUP_HOLD_DAYS });
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "pickup-reminders") {
    const hours = Math.min(96, Math.max(2, parseInt(form.get("pickupReminderHours"), 10) || 24));
    const data = { pickupReminderEnabled: form.get("pickupReminderEnabled") === "true", pickupReminderHours: hours, pickupReminderLastDay: form.get("pickupReminderLastDay") !== "false" };
    await prisma.shopSettings.upsert({ where: { shop: session.shop }, update: data, create: { shop: session.shop, ...data } });
    return json({ ok: data.pickupReminderEnabled ? `Reamintirile de ridicare sunt pornite (după ${hours} ore).` : "Reamintirile de ridicare sunt oprite." });
  }
  const enabled = form.get("whatsappConfirm") === "true";
  const rawPhone = String(form.get("whatsappPhone") || "").trim();
  const phone = rawPhone ? normalizeWhatsappPhone(rawPhone) : null;
  if (rawPhone && !phone) return json({ error: "Numărul de WhatsApp nu pare corect. Scrie-l cu prefixul țării, de exemplu +40 761 034 629." });
  if (enabled && !phone) return json({ error: "Ca să pornești confirmarea, completează numărul de WhatsApp Business." });
  const text = (k, max) => String(form.get(k) || "").trim().slice(0, max) || null;
  const data = {
    whatsappConfirm: enabled,
    whatsappPhone: phone,
    whatsappName: text("whatsappName", 60),
    whatsappTitle: text("whatsappTitle", 80),
    whatsappText: text("whatsappText", 300),
    whatsappButton: text("whatsappButton", 40),
    whatsappMessage: text("whatsappMessage", 300),
    whatsappCodOnly: form.get("whatsappCodOnly") !== "false",
  };
  const saved = await prisma.shopSettings.upsert({ where: { shop: session.shop }, update: data, create: { shop: session.shop, ...data } });
  try {
    await syncWhatsappMetafield(admin, saved);
  } catch (e) {
    return json({ error: `Setările s-au salvat, dar nu au ajuns în Shopify: ${e.message}. Încearcă din nou.` });
  }
  await logActivity({ shop: session.shop, action: "whatsapp_settings", message: enabled ? `Confirmare WhatsApp pornită (${phone})` : "Confirmare WhatsApp oprită" }).catch(() => {});
  return json({ ok: enabled ? "Salvat. Blocul apare pe pagina de mulțumire după ce îl adaugi din editor." : "Salvat. Confirmarea pe WhatsApp e oprită." });
}

export default function WhatsAppPage() {
  const { settings: s, shop, shopName, confirmed, reminded, mailReady, holdDays } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [f, setF] = useState(() => ({
    whatsappConfirm: !!s.whatsappConfirm,
    whatsappPhone: s.whatsappPhone ? `+${s.whatsappPhone}` : "",
    whatsappName: s.whatsappName || "",
    whatsappTitle: s.whatsappTitle || "",
    whatsappText: s.whatsappText || "",
    whatsappButton: s.whatsappButton || "",
    whatsappMessage: s.whatsappMessage || "",
    whatsappCodOnly: s.whatsappCodOnly !== false,
  }));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (actionData?.ok) setDirty(false); }, [actionData]);
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };

  const phone = normalizeWhatsappPhone(f.whatsappPhone);
  const name = f.whatsappName || shopName;
  const sample = renderWhatsappMessage(f.whatsappMessage || WHATSAPP_DEFAULTS.message, { cod: "XJ7KA2B9", magazin: name, total: "149.90 RON" });
  const editorUrl = `https://${shop}/admin/settings/checkout/editor?page=thank-you&context=apps`;
  const live = s.whatsappConfirm && s.whatsappPhone;
  const save = () => submit({ ...f, whatsappConfirm: String(f.whatsappConfirm), whatsappCodOnly: String(f.whatsappCodOnly) }, { method: "post" });
  const busy = nav.state !== "idle";
  const steps = useMemo(() => [
    { done: !!phone, label: "Numărul tău de WhatsApp Business e completat" },
    { done: !!live, label: "Confirmarea e pornită și salvată" },
  ], [phone, live]);

  return (
    <Page
      title="Mesaje către clienți"
      subtitle="Confirmarea comenzii pe WhatsApp și reamintirile pe email pentru coletele care așteaptă în locker."
      primaryAction={{ content: "Salvează WhatsApp", onAction: save, loading: busy, disabled: !dirty }}
    >
      <Layout>
        {actionData?.error && <Layout.Section><Banner tone="critical">{actionData.error}</Banner></Layout.Section>}
        {actionData?.ok && <Layout.Section><Banner tone="success">{actionData.ok}</Banner></Layout.Section>}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Cum funcționează</Text>
              <List type="number">
                <List.Item>Clientul plasează comanda, de obicei cu ramburs.</List.Item>
                <List.Item>Pe pagina de mulțumire vede butonul <b>{f.whatsappButton || WHATSAPP_DEFAULTS.button}</b>.</List.Item>
                <List.Item>Butonul îi deschide WhatsApp cu mesajul gata scris, cu codul comenzii, către numărul tău.</List.Item>
                <List.Item>Primești mesajul în WhatsApp Business și știi că, cel mai probabil, clientul va ridica coletul.</List.Item>
              </List>
              <Text tone="subdued" variant="bodySm">Mesajele vin direct la tine, fără intermediari, deci nu plătești nimic pe mesaj. Codul comenzii e cel afișat de Shopify pe pagina de mulțumire și îl găsești și în Picklo, la comandă.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center"><Text variant="headingMd">Confirmare pe WhatsApp</Text>{live ? <Badge tone="success">Pornită</Badge> : <Badge>Oprită</Badge>}</InlineStack>
              <Checkbox label="Pornește confirmarea pe WhatsApp" checked={f.whatsappConfirm} onChange={set("whatsappConfirm")} />
              <TextField label="Numărul tău de WhatsApp Business" value={f.whatsappPhone} onChange={set("whatsappPhone")} autoComplete="tel"
                placeholder="+40 761 034 629"
                helpText={f.whatsappPhone && !phone ? "Scrie numărul cu prefixul țării, de exemplu +40 761 034 629." : "Numărul pe care ai instalată aplicația WhatsApp Business. Aici primești confirmările."}
                error={f.whatsappPhone && !phone ? "Număr incomplet" : undefined} />
              <TextField label="Numele afișat" value={f.whatsappName} onChange={set("whatsappName")} autoComplete="organization"
                placeholder={shopName || "AMA Beauty"} helpText="Apare în mesajul clientului. Gol = numele magazinului din Shopify." />
              <Checkbox label="Arată blocul doar la comenzile cu plata la livrare (ramburs)" checked={f.whatsappCodOnly} onChange={set("whatsappCodOnly")}
                helpText="Comenzile plătite cu cardul nu au nevoie de confirmare." />
              <Divider />
              <Text variant="headingSm">Textele de pe pagina de mulțumire</Text>
              <TextField label="Titlu" value={f.whatsappTitle} onChange={set("whatsappTitle")} placeholder={WHATSAPP_DEFAULTS.title} autoComplete="off" maxLength={80} />
              <TextField label="Text" value={f.whatsappText} onChange={set("whatsappText")} placeholder={WHATSAPP_DEFAULTS.text} multiline={2} autoComplete="off" maxLength={300} />
              <TextField label="Textul butonului" value={f.whatsappButton} onChange={set("whatsappButton")} placeholder={WHATSAPP_DEFAULTS.button} autoComplete="off" maxLength={40} />
              <TextField label="Mesajul pe care îl trimite clientul" value={f.whatsappMessage} onChange={set("whatsappMessage")} placeholder={WHATSAPP_DEFAULTS.message}
                multiline={2} autoComplete="off" maxLength={300}
                helpText={`Poți folosi ${WHATSAPP_PLACEHOLDERS.join(", ")}: codul comenzii, numele magazinului și totalul.`} />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <PickupRemindersCard s={s} mailReady={mailReady} reminded={reminded} holdDays={holdDays} />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Ce mai ai de făcut</Text>
                {steps.map((st) => (
                  <InlineStack key={st.label} gap="200" blockAlign="start" wrap={false}>
                    <Badge tone={st.done ? "success" : undefined}>{st.done ? "Gata" : "De făcut"}</Badge>
                    <Text>{st.label}</Text>
                  </InlineStack>
                ))}
                <Divider />
                <Text fontWeight="semibold">Ultimul pas: adaugă blocul pe pagina de mulțumire</Text>
                <Button url={editorUrl} target="_top" variant="primary">Deschide pagina de mulțumire în editor</Button>
                <Text tone="subdued" variant="bodySm">În editor: Adaugă bloc → Aplicații → „Picklo Checkout” (blocul cu butonul de WhatsApp). Pune-l sus, sub mesajul de mulțumire, ca să se vadă imediat. Apoi apasă Salvează în editor.</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Previzualizare</Text>
                <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                  <BlockStack gap="200">
                    <Text variant="headingSm">{f.whatsappTitle || WHATSAPP_DEFAULTS.title}</Text>
                    <Text>{f.whatsappText || WHATSAPP_DEFAULTS.text}</Text>
                    <Text tone="subdued">Cod comandă: XJ7KA2B9</Text>
                    <Button fullWidth variant="primary" disabled>{f.whatsappButton || WHATSAPP_DEFAULTS.button}</Button>
                  </BlockStack>
                </Box>
                <Text tone="subdued" variant="bodySm">Mesajul clientului:</Text>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200"><Text>{sample}</Text></Box>
                {phone && <Button url={whatsappLink(phone, sample)} target="_blank">Încearcă linkul pe telefonul tău</Button>}
                {confirmed > 0 && <Text tone="subdued" variant="bodySm">{confirmed} comenzi marcate ca „confirmate de client”.</Text>}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

const COURIER_NAMES = { sameday: "Sameday easybox", fan: "FANbox", cargus: "Cargus Ship & Go", gls: "GLS ParcelShop", dpd: "DPD Pickup", packeta: "Packeta" };

function PickupRemindersCard({ s, mailReady, reminded, holdDays }) {
  const submit = useSubmit();
  const nav = useNavigation();
  const [on, setOn] = useState(!!s.pickupReminderEnabled);
  const [hours, setHours] = useState(String(s.pickupReminderHours || 24));
  const [lastDay, setLastDay] = useState(s.pickupReminderLastDay !== false);
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "pickup-reminders";
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center"><Text variant="headingMd">Reamintire ridicare colet</Text>{s.pickupReminderEnabled ? <Badge tone="success">Pornită</Badge> : <Badge>Oprită</Badge>}</InlineStack>
          <Button loading={busy} onClick={() => submit({ intent: "pickup-reminders", pickupReminderEnabled: String(on), pickupReminderHours: hours, pickupReminderLastDay: String(lastDay) }, { method: "post" })}>Salvează</Button>
        </InlineStack>
        <Text tone="subdued">Când coletul ajunge în locker sau la punctul de ridicare și clientul nu îl ia, Picklo îi trimite un email cu adresa punctului, AWB-ul și suma de plată. Merge la toți curierii. Mai puține colete returnate înseamnă mai puțin transport plătit de două ori.</Text>
        {!mailReady && <Banner tone="warning">Trimiterea de emailuri nu e încă configurată pe server. Setările se salvează, iar emailurile pleacă de când e configurată.</Banner>}
        <Checkbox label="Trimite reamintiri pe email" checked={on} onChange={setOn} />
        <TextField label="Prima reamintire după" type="number" suffix="ore" value={hours} onChange={setHours} min={2} max={96} autoComplete="off"
          helpText="Socotite de când coletul a ajuns în locker, după tracking." />
        <Checkbox label="A doua reamintire în ultima zi, înainte să se întoarcă la tine" checked={lastDay} onChange={setLastDay}
          helpText={`Cât păstrează curierii coletul, de obicei: ${Object.entries(holdDays || {}).map(([c, d]) => `${COURIER_NAMES[c]} ${d} zile`).join(", ")}.`} />
        <Text tone="subdued" variant="bodySm">Pe WhatsApp reamintirea ar costa per mesaj (clientul nu ți-a scris în ultimele 24 de ore), de aceea folosim emailul, care e gratuit.{reminded > 0 ? ` Până acum: ${reminded} comenzi reamintite.` : ""}</Text>
      </BlockStack>
    </Card>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = boundary.headers;
