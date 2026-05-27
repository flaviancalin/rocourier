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
      subtitle={t("widget_page_subtitle")}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <p>{t("widget_banner_text")}</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">{t("widget_what_title")}</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" tone="subdued">{t("widget_what_desc")}</Text>
                <Divider />
                <Text variant="bodySm" tone="subdued">• {t("widget_feature_1")}</Text>
                <Text variant="bodySm" tone="subdued">• {t("widget_feature_2")}</Text>
                <Text variant="bodySm" tone="subdued">• {t("widget_feature_3")}</Text>
                <Text variant="bodySm" tone="subdued">• {t("widget_feature_4")}</Text>
                <Text variant="bodySm" tone="subdued">• {t("widget_feature_5")}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">{t("widget_install_title")}</Text>
              <Text variant="bodyMd" tone="subdued">{t("widget_install_desc")}</Text>
              <Divider />
              <BlockStack gap="300">
                <Box>
                  <Button
                    variant="primary"
                    onClick={() => window.open(
                      "mailto:theflashstations@gmail.com?subject=Instalare%20widget%20cart%20drawer&body=Buna%20ziua%2C%20as%20dori%20instalarea%20widgetului%20Picklo%20pe%20magazinul%20meu.",
                      "_blank"
                    )}
                  >
                    {t("widget_email_btn")}
                  </Button>
                </Box>
                <Text variant="bodySm" tone="subdued">{t("widget_whatsapp_note")}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
