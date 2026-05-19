// app/routes/app.widget.jsx
// Admin page: Picklo Cart Drawer Widget — generates injectable Liquid snippet
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { useState, useCallback } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Button, TextField, Checkbox, Banner, Divider, Box,
} from "@shopify/polaris";
import { useTranslation } from "../context/i18n.jsx";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  const appUrl = process.env.SHOPIFY_APP_URL
    || process.env.HOST
    || "https://rocourier-production.up.railway.app";

  return json({
    shop: session.shop,
    appUrl: appUrl.replace(/\/$/, ""),
    settings: settings
      ? {
          fanEnabled:              settings.fanEnabled,
          fanHomeDeliveryFee:      settings.fanHomeDeliveryFee,
          fanPickupFee:            settings.fanPickupFee,
          samedayEnabled:          settings.samedayEnabled,
          samedayHomeDeliveryFee:  settings.samedayHomeDeliveryFee,
          samedayPickupFee:        settings.samedayPickupFee,
          cargusEnabled:           settings.cargusEnabled,
          cargusHomeDeliveryFee:   settings.cargusHomeDeliveryFee,
          cargusPickupFee:         settings.cargusPickupFee,
          glsEnabled:              settings.glsEnabled,
          glsHomeDeliveryFee:      settings.glsHomeDeliveryFee,
          glsPickupFee:            settings.glsPickupFee,
          packetaEnabled:          settings.packetaEnabled,
          packetaHomeDeliveryFee:  settings.packetaHomeDeliveryFee,
          packetaPickupFee:        settings.packetaPickupFee,
        }
      : null,
  });
}

function buildHeadSnippet({ appUrl }) {
  return `{% comment %}Picklo — Step 1: paste into theme.liquid inside <head>{% endcomment %}
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" crossorigin="">
<link rel="stylesheet" href="${appUrl}/picklo-drawer.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" crossorigin=""></script>
<script src="${appUrl}/picklo-drawer.js"></script>`;
}

function buildBodySnippet({ appUrl, cfg }) {
  const b = (v) => v ? "true" : "false";
  const n = (v) => Number(v) || 0;

  return `{% comment %}Picklo — Step 2: paste into snippets/picklo-drawer.liquid{% endcomment %}
{% comment %}Then add {%- render 'picklo-drawer' -%} inside your cart drawer template{% endcomment %}

<div
  id="picklo-drawer-widget"
  class="picklo-drawer-widget"
  data-shop="{{ shop.permanent_domain }}"
  data-app-url="${appUrl}"
  data-currency="{{ cart.currency.iso_code | default: 'RON' }}"
  data-lang="{{ request.locale.iso_code | slice: 0, 2 | downcase }}"
  data-country="{{ localization.country.iso_code | downcase | default: 'ro' }}"
  data-fan-enabled="${b(cfg.fanEnabled)}"
  data-fan-home-fee="${n(cfg.fanHomeDeliveryFee)}"
  data-fan-pickup-fee="${n(cfg.fanPickupFee)}"
  data-sameday-enabled="${b(cfg.samedayEnabled)}"
  data-sameday-home-fee="${n(cfg.samedayHomeDeliveryFee)}"
  data-sameday-pickup-fee="${n(cfg.samedayPickupFee)}"
  data-cargus-enabled="${b(cfg.cargusEnabled)}"
  data-cargus-home-fee="${n(cfg.cargusHomeDeliveryFee)}"
  data-cargus-pickup-fee="${n(cfg.cargusPickupFee)}"
  data-gls-enabled="${b(cfg.glsEnabled)}"
  data-gls-home-fee="${n(cfg.glsHomeDeliveryFee)}"
  data-gls-pickup-fee="${n(cfg.glsPickupFee)}"
  data-packeta-enabled="${b(cfg.packetaEnabled)}"
  data-packeta-home-fee="${n(cfg.packetaHomeDeliveryFee)}"
  data-packeta-pickup-fee="${n(cfg.packetaPickupFee)}"
  data-fan-logo="${appUrl}/logo-fan.svg"
  data-sameday-logo="${appUrl}/logo-sameday.svg"
  data-cargus-logo="${appUrl}/logo-cargus.svg"
  data-gls-logo="${appUrl}/logo-gls.svg"
  data-packeta-logo="${appUrl}/logo-packeta.svg"
  data-fan-pin="${appUrl}/pin-fan.png"
  data-sameday-pin="${appUrl}/pin-sameday.png"
  data-cargus-pin="${appUrl}/pin-cargus.png"
  data-gls-pin="${appUrl}/pin-gls.png"
  data-packeta-pin="${appUrl}/pin-packeta.png"
>
  <p class="pkd-section-title" id="pkd-section-title">Metoda de livrare:</p>

  <div class="pkd-methods" role="radiogroup" aria-label="Metoda de livrare">
    <div class="pkd-method-row" id="pkd-home-row" role="radio" aria-checked="false" tabindex="0" data-rc-value="home">
      <span class="pkd-method-icon pkd-icon-home">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex-shrink:0;">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      </span>
      <span class="pkd-method-text">
        <strong id="pkd-home-label">Livrare la domiciliu</strong>
        <small id="pkd-home-sub">Livrare standard la adresă</small>
      </span>
      <span id="pkd-home-fee" class="pkd-method-fee"></span>
      <span class="pkd-method-radio"></span>
    </div>

    <div class="pkd-method-row pkd-row-last" id="pkd-pickup-row" role="radio" aria-checked="false" tabindex="0" data-rc-value="pickup">
      <span class="pkd-method-icon pkd-icon-box">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex-shrink:0;">
          <rect x="2" y="3" width="20" height="18" rx="2"/>
          <line x1="2" y1="9" x2="22" y2="9"/>
          <line x1="12" y1="9" x2="12" y2="21"/>
        </svg>
      </span>
      <span class="pkd-method-text">
        <strong id="pkd-pickup-label">Ridicare din punct fix</strong>
        <small id="pkd-pickup-sub">Locker, easybox, ParcelShop...</small>
      </span>
      <span id="pkd-pickup-fee" class="pkd-method-fee"></span>
      <span class="pkd-method-radio"></span>
    </div>
  </div>

  <div id="pkd-point-selected" class="pkd-point-selected" style="display:none;">
    <img id="pkd-point-logo" class="pkd-point-logo" src="" alt="" width="60" height="20">
    <div class="pkd-point-info">
      <strong id="pkd-point-name"></strong>
      <span id="pkd-point-addr"></span>
    </div>
    <button type="button" id="pkd-change-point" class="pkd-change-btn">Schimbă</button>
  </div>

  <div id="pkd-error" class="pkd-error" style="display:none;"></div>
</div>

<div id="pkd-modal" class="pkd-modal" style="display:none;" role="dialog" aria-modal="true">
  <div class="pkd-modal-backdrop" id="pkd-modal-backdrop"></div>
  <div class="pkd-modal-inner">
    <div class="pkd-map-panel" id="pkd-map-panel">
      <div id="pkd-map"></div>
      <button type="button" id="pkd-modal-close" class="pkd-modal-close" aria-label="Close">&#x2715;</button>
    </div>
    <div class="pkd-bottom-sheet" id="pkd-bottom-sheet">
      <div class="pkd-sheet-handle" id="pkd-sheet-handle">
        <div class="pkd-sheet-pill"></div>
      </div>
      <div class="pkd-sheet-header">
        <div class="pkd-modal-search-wrap">
          <svg class="pkd-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="pkd-search" class="pkd-search-input" placeholder="Oraș, cod poștal, adresă..." autocomplete="off">
        </div>
        <button type="button" class="pkd-filter-toggle" id="pkd-filter-toggle" aria-label="Filters">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        </button>
      </div>
      <div class="pkd-modal-filters" id="pkd-type-filters">
        <button type="button" class="pkd-filter-btn pkd-filter-active" id="pkd-filter-all" data-courier="all">Toate</button>${cfg.fanEnabled ? `\n        <button type="button" class="pkd-filter-btn" data-courier="fan"><img src="${appUrl}/logo-fan.svg" alt="FAN" class="pkd-filter-logo" width="48" height="16"></button>` : ""}${cfg.samedayEnabled ? `\n        <button type="button" class="pkd-filter-btn" data-courier="sameday"><img src="${appUrl}/logo-sameday.svg" alt="Sameday" class="pkd-filter-logo" width="48" height="16"></button>` : ""}${cfg.cargusEnabled ? `\n        <button type="button" class="pkd-filter-btn" data-courier="cargus"><img src="${appUrl}/logo-cargus.svg" alt="Cargus" class="pkd-filter-logo" width="48" height="16"></button>` : ""}${cfg.glsEnabled ? `\n        <button type="button" class="pkd-filter-btn" data-courier="gls"><img src="${appUrl}/logo-gls.svg" alt="GLS" class="pkd-filter-logo" width="48" height="16"></button>` : ""}${cfg.packetaEnabled ? `\n        <button type="button" class="pkd-filter-btn" data-courier="packeta"><img src="${appUrl}/logo-packeta.svg" alt="Packeta" class="pkd-filter-logo" width="48" height="16"></button>` : ""}
      </div>
      <div class="pkd-sheet-body">
        <div id="pkd-list-loading" class="pkd-list-loading">
          <div class="pkd-spinner"></div>
          <span id="pkd-loading-text">Se încarcă punctele de ridicare...</span>
        </div>
        <div id="pkd-list-empty" style="display:none;" class="pkd-list-empty"></div>
        <ul id="pkd-points-list" class="pkd-points-list"></ul>
        <div id="pkd-list-count" class="pkd-list-count" style="display:none;"></div>
      </div>
    </div>
  </div>
</div>

<style>
  #picklo-drawer-widget,
  #picklo-drawer-widget ~ * {
    --pkd-primary: #222222;
    --pkd-bg:      #ffffff;
    --pkd-border:  #e0e0e0;
    --pkd-radius:  10px;
  }
</style>

`;
}

export default function WidgetPage() {
  const { appUrl, settings, shop } = useLoaderData();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;
  const { t } = useTranslation();

  const defaultCfg = {
    fanEnabled:             settings?.fanEnabled              ?? true,
    fanHomeDeliveryFee:     settings?.fanHomeDeliveryFee      ?? 0,
    fanPickupFee:           settings?.fanPickupFee            ?? 0,
    samedayEnabled:         settings?.samedayEnabled          ?? false,
    samedayHomeDeliveryFee: settings?.samedayHomeDeliveryFee  ?? 0,
    samedayPickupFee:       settings?.samedayPickupFee        ?? 0,
    cargusEnabled:          settings?.cargusEnabled           ?? false,
    cargusHomeDeliveryFee:  settings?.cargusHomeDeliveryFee   ?? 0,
    cargusPickupFee:        settings?.cargusPickupFee         ?? 0,
    glsEnabled:             settings?.glsEnabled              ?? false,
    glsHomeDeliveryFee:     settings?.glsHomeDeliveryFee      ?? 0,
    glsPickupFee:           settings?.glsPickupFee            ?? 0,
    packetaEnabled:         settings?.packetaEnabled          ?? false,
    packetaHomeDeliveryFee: settings?.packetaHomeDeliveryFee  ?? 0,
    packetaPickupFee:       settings?.packetaPickupFee        ?? 0,
  };

  const [cfg, setCfg] = useState(defaultCfg);
  const [copiedHead, setCopiedHead] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  const headSnippet = buildHeadSnippet({ appUrl });
  const bodySnippet = buildBodySnippet({ appUrl, cfg });

  const handleCopyHead = useCallback(() => {
    navigator.clipboard.writeText(headSnippet).then(() => {
      setCopiedHead(true);
      setTimeout(() => setCopiedHead(false), 2500);
    });
  }, [headSnippet]);

  const handleCopyBody = useCallback(() => {
    navigator.clipboard.writeText(bodySnippet).then(() => {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2500);
    });
  }, [bodySnippet]);

  const toggle  = (key) => setCfg((prev) => ({ ...prev, [key]: !prev[key] }));
  const setFee  = (key, val) => setCfg((prev) => ({ ...prev, [key]: parseFloat(val) || 0 }));

  const COURIER_CFG = [
    { key: "fan",     label: "FAN Courier", enabledKey: "fanEnabled",     homeFeeKey: "fanHomeDeliveryFee",     pickupFeeKey: "fanPickupFee"     },
    { key: "sameday", label: "Sameday",     enabledKey: "samedayEnabled", homeFeeKey: "samedayHomeDeliveryFee", pickupFeeKey: "samedayPickupFee" },
    { key: "cargus",  label: "Cargus",      enabledKey: "cargusEnabled",  homeFeeKey: "cargusHomeDeliveryFee",  pickupFeeKey: "cargusPickupFee"  },
    { key: "gls",     label: "GLS",         enabledKey: "glsEnabled",     homeFeeKey: "glsHomeDeliveryFee",     pickupFeeKey: "glsPickupFee"     },
    { key: "packeta", label: "Packeta",     enabledKey: "packetaEnabled", homeFeeKey: "packetaHomeDeliveryFee", pickupFeeKey: "packetaPickupFee" },
  ];

  return (
    <Page
      title={t("nav_widget")}
      subtitle="Instalare widget Picklo în tema Shopify"
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="semibold">Instalare prin Theme Editor (recomandat)</Text>
              <Text variant="bodyMd" tone="subdued">
                Cel mai simplu mod de a adăuga widgetul Picklo este prin Theme Editor.
                Deschide editorul temei, selectează secțiunea Cart Drawer și adaugă blocul Picklo din panoul de aplicații.
              </Text>
              <Button
                variant="primary"
                url={themeEditorUrl}
                external
              >
                Deschide Theme Editor
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info">
            <p>
              <strong>Instalare manuală (avansată)</strong> — dacă tema ta nu suportă blocuri de aplicații
              în cart drawer, poți instala widgetul manual urmând instrucțiunile de mai jos.
            </p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Configurare curieri și tarife</Text>
              <Text variant="bodyMd" tone="subdued">
                Valorile sunt preluate din Setări și pot fi ajustate înainte de a copia snippet-ul.
                Modificările de aici nu se salvează — sunt doar pentru generarea snippet-ului.
              </Text>

              {COURIER_CFG.map(({ key, label, enabledKey, homeFeeKey, pickupFeeKey }) => (
                <Box key={key} padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Checkbox
                      label={<Text variant="bodyMd" fontWeight="semibold">{label}</Text>}
                      checked={cfg[enabledKey]}
                      onChange={() => toggle(enabledKey)}
                    />
                    {cfg[enabledKey] && (
                      <InlineStack gap="300" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Tarif livrare acasă (RON)"
                            type="number"
                            value={String(cfg[homeFeeKey])}
                            onChange={(v) => setFee(homeFeeKey, v)}
                            autoComplete="off"
                            min={0}
                            step={1}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Tarif punct ridicare (RON)"
                            type="number"
                            value={String(cfg[pickupFeeKey])}
                            onChange={(v) => setFee(pickupFeeKey, v)}
                            autoComplete="off"
                            min={0}
                            step={1}
                          />
                        </div>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <p>
                <strong>Instalare în 2 pași</strong> — necesar pentru compatibilitate cu cart drawer pe mobil.
                Temele Shopify reîncarcă conținutul cart drawer via AJAX (innerHTML), ceea ce blochează
                execuția scripturilor inline. Soluția: JS/CSS se încarcă din <code>theme.liquid</code>,
                HTML-ul widgetului rămâne în cart drawer.
              </p>
            </Banner>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Pasul 1 — Assets (theme.liquid)</Text>
                    <Text variant="bodyMd" tone="subdued">
                      Adaugă în <code>layout/theme.liquid</code> înainte de <code>&lt;/head&gt;</code>
                    </Text>
                  </BlockStack>
                  <Button variant="primary" onClick={handleCopyHead}>
                    {copiedHead ? "Copiat!" : "Copiază"}
                  </Button>
                </InlineStack>
                <div style={{
                  background: "#1e1e1e", borderRadius: "8px", padding: "16px",
                  maxHeight: "200px", overflowY: "auto", fontFamily: "monospace",
                  fontSize: "11px", lineHeight: "1.5", color: "#d4d4d4",
                  whiteSpace: "pre", overflowX: "auto",
                }}>
                  {headSnippet}
                </div>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Pasul 2 — Widget HTML (snippets/picklo-drawer.liquid)</Text>
                    <Text variant="bodyMd" tone="subdued">
                      Se actualizează live. Copiază în <code>snippets/picklo-drawer.liquid</code>.
                    </Text>
                  </BlockStack>
                  <Button variant="primary" onClick={handleCopyBody}>
                    {copiedBody ? "Copiat!" : "Copiază"}
                  </Button>
                </InlineStack>
                <div style={{
                  background: "#1e1e1e", borderRadius: "8px", padding: "16px",
                  maxHeight: "420px", overflowY: "auto", fontFamily: "monospace",
                  fontSize: "11px", lineHeight: "1.5", color: "#d4d4d4",
                  whiteSpace: "pre", overflowX: "auto",
                }}>
                  {bodySnippet}
                </div>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Instrucțiuni de instalare</Text>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Pasul 1 — Assets în theme.liquid</Text>
                  <Text variant="bodyMd" tone="subdued">
                    <strong>Online Store → Themes → Edit code → layout/theme.liquid</strong>.
                    Lipește snippet-ul de assets înainte de <code>&lt;/head&gt;</code>.
                    Acest pas asigură că JS-ul se încarcă o singură dată și supraviețuiește
                    refresh-urilor AJAX ale cart drawer-ului.
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Pasul 2 — Creează fișierul snippet</Text>
                  <Text variant="bodyMd" tone="subdued">
                    Navighează la <code>snippets/</code>, creează <strong>picklo-drawer.liquid</strong>.
                    Lipește snippet-ul HTML (Pasul 2 de mai sus).
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Pasul 3 — Inserează render tag în cart drawer</Text>
                  <Text variant="bodyMd" tone="subdued">
                    Deschide secțiunea cart drawer și adaugă înainte de butonul checkout:
                  </Text>
                  <div style={{
                    background: "#1e1e1e", borderRadius: "6px", padding: "12px 16px",
                    fontFamily: "monospace", fontSize: "12px", color: "#d4d4d4",
                  }}>
                    {`{%- render 'picklo-drawer' -%}`}
                  </div>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Teme populare — cart drawer section</Text>
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued"><strong>Dawn:</strong> <code>sections/cart-drawer.liquid</code></Text>
                    <Text variant="bodyMd" tone="subdued"><strong>Debut:</strong> <code>sections/cart-template.liquid</code></Text>
                    <Text variant="bodyMd" tone="subdued"><strong>Impulse / Prestige:</strong> <code>sections/cart.liquid</code></Text>
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
