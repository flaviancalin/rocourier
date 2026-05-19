// app/routes/app.widget.jsx
// Admin page: Picklo Cart Drawer Widget — generates injectable Liquid snippet
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import {
  Page, Layout, Card, Text, BlockStack,
  Button, Banner, Divider, Box,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  return json({ shop: session.shop });
}


export default function WidgetPage() {
  const { shop } = useLoaderData();
  const { t } = useTranslation();

  // Deep link: opens Theme Editor on the cart template and auto-adds the Picklo app block
  const addBlockUrl  = `https://${shop}/admin/themes/current/editor?template=cart&addAppBlockId=rocourier-cart/shipping-selector&target=newAppsSection`;
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=cart`;

  return (
    <Page
      title={t("nav_widget")}
      subtitle="Instalare widget Picklo prin Shopify Theme App Extension"
    >
      <Layout>
        <Layout.Section>
          <Banner tone="success">
            <p>
              Widgetul Picklo folosește o <strong>Theme App Extension</strong> — instalarea nu necesită
              modificarea manuală a codului temei tale.
            </p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Pasul 1 — Adaugă blocul în tema ta</Text>
              <Text variant="bodyMd" tone="subdued">
                Apasă butonul de mai jos. Shopify va deschide Theme Editor pe template-ul Cart și va
                adăuga automat blocul <strong>Picklo Cart Widget</strong> în secțiunea de aplicații.
              </Text>
              <Box>
                <Button variant="primary" url={addBlockUrl} external size="large">
                  Adaugă widgetul Picklo în temă
                </Button>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Pasul 2 — Configurează curierii și tarifele</Text>
              <Text variant="bodyMd" tone="subdued">
                După ce blocul este adăugat, selectează-l în Theme Editor. În panoul din dreapta vei
                putea activa/dezactiva fiecare curier și seta tarifele de livrare acasă și la punct de ridicare.
              </Text>
              <Divider />
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" fontWeight="semibold">Ce poți configura direct în tema:</Text>
                <Text variant="bodySm" tone="subdued">• Activare FAN Courier, Sameday, Cargus, GLS, Packeta</Text>
                <Text variant="bodySm" tone="subdued">• Tarife livrare acasă și punct ridicare (RON) per curier</Text>
                <Text variant="bodySm" tone="subdued">• URL aplicație (completat automat)</Text>
              </BlockStack>
              <Box>
                <Button url={themeEditorUrl} external>
                  Deschide Theme Editor
                </Button>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" fontWeight="semibold">Credențiale API curieri</Text>
              <Text variant="bodyMd" tone="subdued">
                Cheile API și credențialele pentru fiecare curier se configurează în pagina{" "}
                <strong>Setări</strong>, nu în tema Shopify.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
