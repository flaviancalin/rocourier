// app/routes/hq_.login.jsx — sign-in for the Picklo team (outside the /hq layout)
import { json } from "@remix-run/node";
import { Form, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Page, Card, BlockStack, TextField, Button, Banner, Text, Box } from "@shopify/polaris";
import { useState } from "react";
import { login, createTeamSession } from "../services/hq-auth.server.js";
import { HqProvider } from "../components/hq/HqShell.jsx";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta = () => [{ title: "Picklo HQ — autentificare" }, { name: "robots", content: "noindex, nofollow" }];

export async function action({ request }) {
  const form = await request.formData();
  const r = await login(form.get("email"), form.get("password"));
  if (r.error) return json({ error: r.error }, { status: 401 });
  const next = String(form.get("next") || "/hq");
  return createTeamSession(r.member, next.startsWith("/hq") ? next : "/hq");
}

export default function HqLogin() {
  const data = useActionData();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <HqProvider>
      <Page narrowWidth>
        <Box paddingBlockStart="1600">
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <Text variant="headingLg" as="h1">Picklo HQ</Text>
                <Text tone="subdued">Dashboard-ul echipei Picklo: tichete și suport pentru magazine.</Text>
                {data?.error && <Banner tone="critical">{data.error}</Banner>}
                <input type="hidden" name="next" value={params.get("next") || "/hq"} />
                <TextField label="Email" name="email" type="email" autoComplete="username" value={email} onChange={setEmail} />
                <TextField label="Parolă" name="password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
                <Button submit variant="primary" loading={nav.state !== "idle"}>Intră</Button>
              </BlockStack>
            </Form>
          </Card>
        </Box>
      </Page>
    </HqProvider>
  );
}
