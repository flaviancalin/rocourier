// app/routes/app.widget.jsx
// Admin page: Picklo Cart Drawer Widget — generates injectable Liquid snippet
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import {
  Page, Layout, Card, Text, BlockStack,
  Button, Banner, Divider, Box,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}


export default function WidgetPage() {
  const { t } = useTranslation();

  return (
    <Page
      title={t("nav_widget")}
      subtitle="Widget selector curier pentru cart drawer"
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <p>
              Widgetul Picklo pentru cart drawer se integrează direct în tema magazinului tău.
              Deoarece fiecare temă Shopify are o structură diferită, echipa noastră se ocupă
              de instalare gratuit — fără modificări manuale din partea ta.
            </p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Ce face widgetul</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">
                  Widgetul apare în cart drawer-ul magazinului tău și permite clienților să aleagă
                  metoda de livrare (acasă sau punct de ridicare) înainte de checkout.
                </Text>
                <Divider />
                <Text variant="bodySm" tone="subdued">• Selector livrare acasă vs. punct de ridicare (locker, easybox, ParcelShop)</Text>
                <Text variant="bodySm" tone="subdued">• Hartă interactivă cu toate punctele de ridicare disponibile</Text>
                <Text variant="bodySm" tone="subdued">• Suport FAN Courier, Sameday, Cargus, GLS, Packeta</Text>
                <Text variant="bodySm" tone="subdued">• Compatibil cu temele Dawn, Debut, Impulse, Prestige și altele</Text>
                <Text variant="bodySm" tone="subdued">• Răspunde la setarea de limbă din aplicație (RO / EN / DE / HU)</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Solicită instalarea gratuită</Text>
              <Text variant="bodyMd" tone="subdued">
                Trimite-ne un email sau un mesaj WhatsApp și ne ocupăm de instalare în termen de 24 de ore.
                Nu ai nevoie de cunoștințe tehnice — noi facem tot.
              </Text>
              <Divider />
              <BlockStack gap="300">
                <Box>
                  <Button
                    variant="primary"
                    url="mailto:support@picklo.app?subject=Instalare%20widget%20cart%20drawer&body=Buna%20ziua%2C%20as%20dori%20instalarea%20widgetului%20Picklo%20pe%20magazinul%20meu."
                    external
                  >
                    Trimite email — support@picklo.app
                  </Button>
                </Box>
                <Text variant="bodySm" tone="subdued">
                  Sau contactează-ne pe WhatsApp pentru răspuns rapid.
                  Instalarea este gratuită pentru toți utilizatorii Picklo.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
