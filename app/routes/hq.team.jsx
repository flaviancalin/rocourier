// app/routes/hq.team.jsx — team accounts (admins only)
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, TextField, Select, Banner, DataTable } from "@shopify/polaris";
import { requireTeam, hashPassword, passwordProblem } from "../services/hq-auth.server.js";
import { prisma } from "../db.server.js";

export async function loader({ request }) {
  const me = await requireTeam(request, { role: "admin" });
  const members = await prisma.teamMember.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true } });
  return json({ me, members });
}

export async function action({ request }) {
  const me = await requireTeam(request, { role: "admin" });
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "add") {
      const email = String(form.get("email") || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email invalid.");
      const problem = passwordProblem(form.get("password"));
      if (problem) throw new Error(problem);
      await prisma.teamMember.create({ data: { email, name: String(form.get("name") || email.split("@")[0]).trim(), role: form.get("role") === "admin" ? "admin" : "support", passwordHash: hashPassword(form.get("password")) } });
      return json({ ok: `Cont creat pentru ${email}. Trimite-i parola pe un canal sigur.` });
    }
    const id = String(form.get("id"));
    if (id === me.id && intent !== "password") throw new Error("Nu îți poți dezactiva sau schimba rolul propriului cont.");
    if (intent === "toggle") {
      const m = await prisma.teamMember.findUnique({ where: { id } });
      await prisma.teamMember.update({ where: { id }, data: { active: !m.active } });
      return json({ ok: m.active ? "Cont dezactivat" : "Cont reactivat" });
    }
    if (intent === "role") {
      await prisma.teamMember.update({ where: { id }, data: { role: form.get("role") === "admin" ? "admin" : "support" } });
      return json({ ok: "Rol schimbat" });
    }
    if (intent === "password") {
      const problem = passwordProblem(form.get("password"));
      if (problem) throw new Error(problem);
      await prisma.teamMember.update({ where: { id }, data: { passwordHash: hashPassword(form.get("password")), failedLogins: 0, lockedUntil: null } });
      return json({ ok: "Parolă schimbată" });
    }
  } catch (e) {
    return json({ error: e.code === "P2002" ? "Există deja un cont cu acest email." : e.message });
  }
  return json({ error: "Acțiune necunoscută" }, { status: 400 });
}

export default function Team() {
  const { me, members } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [f, setF] = useState({ email: "", name: "", password: "", role: "support" });
  const [pw, setPw] = useState({});
  useEffect(() => { if (actionData?.ok) { setF({ email: "", name: "", password: "", role: "support" }); setPw({}); } }, [actionData]);

  return (
    <Page title="Echipă">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
            {actionData?.ok && <Banner tone="success">{actionData.ok}</Banner>}
            <Card>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Nume", "Email", "Rol", "Ultima autentificare", ""]}
                rows={members.map((m) => [
                  <InlineStack key="n" gap="100">{m.name}{!m.active && <Badge>dezactivat</Badge>}</InlineStack>,
                  m.email,
                  m.id === me.id ? m.role : (
                    <Select key="r" label="Rol" labelHidden value={m.role} onChange={(role) => submit({ intent: "role", id: m.id, role }, { method: "post" })}
                      options={[{ label: "Suport", value: "support" }, { label: "Administrator", value: "admin" }]} />
                  ),
                  m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "—",
                  <InlineStack key="a" gap="200" wrap={false}>
                    <TextField label="Parolă nouă" labelHidden type="password" placeholder="Parolă nouă" value={pw[m.id] || ""} onChange={(v) => setPw({ ...pw, [m.id]: v })} autoComplete="new-password" />
                    <Button disabled={!pw[m.id]} onClick={() => submit({ intent: "password", id: m.id, password: pw[m.id] }, { method: "post" })}>Setează</Button>
                    {m.id !== me.id && <Button variant="plain" tone={m.active ? "critical" : undefined} onClick={() => submit({ intent: "toggle", id: m.id }, { method: "post" })}>{m.active ? "Dezactivează" : "Reactivează"}</Button>}
                  </InlineStack>,
                ])}
              />
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Adaugă un coleg</Text>
                <InlineStack gap="300" wrap>
                  <TextField label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoComplete="off" />
                  <TextField label="Nume" value={f.name} onChange={(v) => setF({ ...f, name: v })} autoComplete="off" />
                  <TextField label="Parolă inițială (min. 12 caractere)" type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" />
                  <Select label="Rol" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[{ label: "Suport", value: "support" }, { label: "Administrator", value: "admin" }]} />
                </InlineStack>
                <InlineStack><Button variant="primary" loading={nav.state !== "idle"} onClick={() => submit({ intent: "add", ...f }, { method: "post" })}>Creează contul</Button></InlineStack>
                <Text tone="subdued">Suport: tichete și acțiuni pe magazine. Administrator: în plus, gestionează echipa.</Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
