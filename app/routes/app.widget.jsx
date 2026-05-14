// app/routes/app.widget.jsx
// Admin page: Cart Drawer Widget — generates injectable Liquid snippet
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { useState, useCallback } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Button, TextField, Checkbox, Banner, Divider,
  Box,
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

function buildSnippet({ appUrl, cfg }) {
  const boolAttr = (v) => v ? "true" : "false";
  const numAttr  = (v) => Number(v) || 0;

  return `{% comment %}RoCourier Cart Drawer Widget — paste into snippets/rocourier-drawer.liquid{% endcomment %}
{% comment %}Then add {% render 'rocourier-drawer' %} inside your cart drawer template{% endcomment %}

<div
  id="rocourier-drawer-widget"
  class="rocourier-drawer-widget"
  data-shop="{{ shop.permanent_domain }}"
  data-app-url="${appUrl}"
  data-currency="{{ cart.currency.iso_code | default: 'RON' }}"
  data-lang="{{ request.locale.iso_code | slice: 0, 2 | downcase }}"
  data-country="{{ localization.country.iso_code | downcase | default: 'ro' }}"
  data-fan-enabled="${boolAttr(cfg.fanEnabled)}"
  data-fan-home-fee="${numAttr(cfg.fanHomeDeliveryFee)}"
  data-fan-pickup-fee="${numAttr(cfg.fanPickupFee)}"
  data-sameday-enabled="${boolAttr(cfg.samedayEnabled)}"
  data-sameday-home-fee="${numAttr(cfg.samedayHomeDeliveryFee)}"
  data-sameday-pickup-fee="${numAttr(cfg.samedayPickupFee)}"
  data-cargus-enabled="${boolAttr(cfg.cargusEnabled)}"
  data-cargus-home-fee="${numAttr(cfg.cargusHomeDeliveryFee)}"
  data-cargus-pickup-fee="${numAttr(cfg.cargusPickupFee)}"
  data-gls-enabled="${boolAttr(cfg.glsEnabled)}"
  data-gls-home-fee="${numAttr(cfg.glsHomeDeliveryFee)}"
  data-gls-pickup-fee="${numAttr(cfg.glsPickupFee)}"
  data-packeta-enabled="${boolAttr(cfg.packetaEnabled)}"
  data-packeta-home-fee="${numAttr(cfg.packetaHomeDeliveryFee)}"
  data-packeta-pickup-fee="${numAttr(cfg.packetaPickupFee)}"
>
  <p class="rc-section-title" id="rcd-section-title">Metoda de livrare:</p>

  <div class="rc-methods" role="radiogroup" aria-label="Metoda de livrare">
    <div class="rc-method-row" id="rcd-home-row" role="radio" aria-checked="false" tabindex="0" data-rc-value="home">
      <span class="rc-method-icon rc-icon-home">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex-shrink:0;">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      </span>
      <span class="rc-method-text">
        <strong id="rcd-home-label">Livrare la domiciliu</strong>
        <small id="rcd-home-sub">Livrare standard la adresă</small>
      </span>
      <span id="rcd-home-fee" class="rc-method-fee"></span>
      <span class="rc-method-radio"></span>
    </div>

    <div class="rc-method-row rc-row-last" id="rcd-pickup-row" role="radio" aria-checked="false" tabindex="0" data-rc-value="pickup">
      <span class="rc-method-icon rc-icon-box">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex-shrink:0;">
          <rect x="2" y="3" width="20" height="18" rx="2"/>
          <line x1="2" y1="9" x2="22" y2="9"/>
          <line x1="12" y1="9" x2="12" y2="21"/>
        </svg>
      </span>
      <span class="rc-method-text">
        <strong id="rcd-pickup-label">Ridicare din punct fix</strong>
        <small id="rcd-pickup-sub">Locker, easybox, ParcelShop...</small>
      </span>
      <span id="rcd-pickup-fee" class="rc-method-fee"></span>
      <span class="rc-method-radio"></span>
    </div>
  </div>

  <div id="rcd-point-selected" class="rc-point-selected" style="display:none;">
    <img id="rcd-point-logo" class="rc-point-logo" src="" alt="" width="60" height="20">
    <div class="rc-point-info">
      <strong id="rcd-point-name"></strong>
      <span id="rcd-point-addr"></span>
    </div>
    <button type="button" id="rcd-change-point" class="rc-change-btn">Schimbă</button>
  </div>

  <div id="rcd-error" class="rc-error" style="display:none;"></div>
</div>

<div id="rcd-modal" class="rcd-modal" style="display:none;" role="dialog" aria-modal="true">
  <div class="rc-modal-backdrop" id="rcd-modal-backdrop"></div>
  <div class="rc-modal-inner">
    <div class="rc-map-panel" id="rcd-map-panel">
      <div id="rcd-map"></div>
      <button type="button" id="rcd-modal-close" class="rc-modal-close" aria-label="Close">&#x2715;</button>
    </div>
    <div class="rc-bottom-sheet" id="rcd-bottom-sheet">
      <div class="rc-sheet-handle" id="rcd-sheet-handle">
        <div class="rc-sheet-pill"></div>
      </div>
      <div class="rc-sheet-header">
        <div class="rc-modal-search-wrap">
          <svg class="rc-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="rcd-search" class="rc-search-input" placeholder="Oraș, cod poștal, adresă..." autocomplete="off">
        </div>
        <button type="button" class="rc-filter-toggle" id="rcd-filter-toggle" aria-label="Filters">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        </button>
      </div>
      <div class="rc-modal-filters" id="rcd-type-filters">
        <button type="button" class="rcd-filter-btn rc-filter-active" id="rcd-filter-all" data-courier="all">Toate</button>${cfg.fanEnabled ? '\n        <button type="button" class="rcd-filter-btn" data-courier="fan">FAN</button>' : ""}${cfg.samedayEnabled ? '\n        <button type="button" class="rcd-filter-btn" data-courier="sameday">Sameday</button>' : ""}${cfg.cargusEnabled ? '\n        <button type="button" class="rcd-filter-btn" data-courier="cargus">Cargus</button>' : ""}${cfg.glsEnabled ? '\n        <button type="button" class="rcd-filter-btn" data-courier="gls">GLS</button>' : ""}${cfg.packetaEnabled ? '\n        <button type="button" class="rcd-filter-btn" data-courier="packeta">Packeta</button>' : ""}
      </div>
      <div class="rc-sheet-body">
        <div id="rcd-list-loading" class="rc-list-loading">
          <div class="rc-spinner"></div>
          <span id="rcd-loading-text">Se încarcă punctele de ridicare...</span>
        </div>
        <div id="rcd-list-empty" style="display:none;" class="rc-list-empty"></div>
        <ul id="rcd-points-list" class="rc-points-list"></ul>
        <div id="rcd-list-count" class="rc-list-count" style="display:none;"></div>
      </div>
    </div>
  </div>
</div>

<style>
  #rocourier-drawer-widget,
  #rocourier-drawer-widget ~ * {
    --rc-primary: #222222;
    --rc-bg:      #ffffff;
    --rc-border:  #e0e0e0;
    --rc-radius:  10px;
  }
</style>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" crossorigin="">
<link rel="stylesheet" href="${appUrl}/rc-drawer.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer crossorigin=""></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" defer crossorigin=""></script>
<script src="${appUrl}/rc-drawer.js" defer></script>`;
}

export default function WidgetPage() {
  const { appUrl, settings } = useLoaderData();
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
  const [copied, setCopied] = useState(false);

  const snippet = buildSnippet({ appUrl, cfg });

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }, [snippet]);

  const toggle = (key) => setCfg((prev) => ({ ...prev, [key]: !prev[key] }));
  const setFee = (key, val) => setCfg((prev) => ({ ...prev, [key]: parseFloat(val) || 0 }));

  const COURIER_CFG = [
    { key: "fan",     label: "FAN Courier",    enabledKey: "fanEnabled",     homeFeeKey: "fanHomeDeliveryFee",     pickupFeeKey: "fanPickupFee"     },
    { key: "sameday", label: "Sameday",         enabledKey: "samedayEnabled", homeFeeKey: "samedayHomeDeliveryFee", pickupFeeKey: "samedayPickupFee" },
    { key: "cargus",  label: "Cargus",          enabledKey: "cargusEnabled",  homeFeeKey: "cargusHomeDeliveryFee",  pickupFeeKey: "cargusPickupFee"  },
    { key: "gls",     label: "GLS",             enabledKey: "glsEnabled",     homeFeeKey: "glsHomeDeliveryFee",     pickupFeeKey: "glsPickupFee"     },
    { key: "packeta", label: "Packeta",         enabledKey: "packetaEnabled", homeFeeKey: "packetaHomeDeliveryFee", pickupFeeKey: "packetaPickupFee" },
  ];

  return (
    <Page
      title={t("nav_widget")}
      subtitle="Snippet injectabil pentru magazine cu cart drawer"
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <p>
              Widgetul pentru cart drawer se instalează manual în tema Shopify,
              complet separat de widgetul de pe pagina de coș. Configurează curierii și tarifele
              mai jos, copiază snippet-ul generat și inserează-l în tema ta.
            </p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Configurare curieri și tarife</Text>
              <Text variant="bodyMd" tone="subdued">
                Valorile sunt preluate din Setări și pot fi ajustate aici înainte de a copia snippet-ul.
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
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Snippet generat</Text>
                  <Button
                    variant="primary"
                    onClick={handleCopy}
                    icon={copied ? undefined : undefined}
                  >
                    {copied ? "Copiat!" : "Copiază snippet"}
                  </Button>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  Snippet-ul se actualizează automat la modificarea configurației.
                  Copiază-l și inserează-l în <code>snippets/rocourier-drawer.liquid</code>.
                </Text>
                <div style={{
                  background: "#1e1e1e",
                  borderRadius: "8px",
                  padding: "16px",
                  maxHeight: "400px",
                  overflowY: "auto",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  lineHeight: "1.5",
                  color: "#d4d4d4",
                  whiteSpace: "pre",
                  overflowX: "auto",
                }}>
                  {snippet}
                </div>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Instrucțiuni de instalare</Text>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Pasul 1 — Creează fișierul snippet</Text>
                  <Text variant="bodyMd" tone="subdued">
                    În Shopify admin: <strong>Online Store → Themes → Edit code</strong>.
                    Navighează la folderul <code>snippets/</code> și creează un fișier nou numit
                    <strong> rocourier-drawer.liquid</strong>. Lipește snippet-ul copiat.
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Pasul 2 — Inserează în cart drawer</Text>
                  <Text variant="bodyMd" tone="subdued">
                    Deschide fișierul Liquid al cart drawer-ului temei tale (ex.{" "}
                    <code>sections/cart-drawer.liquid</code> sau <code>sections/cart.liquid</code>).
                    Găsește locul unde se afișează butonul de checkout și adaugă înainte:
                  </Text>
                  <div style={{
                    background: "#1e1e1e",
                    borderRadius: "6px",
                    padding: "12px 16px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: "#d4d4d4",
                  }}>
                    {`{%- render 'rocourier-drawer' -%}`}
                  </div>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Teme populare</Text>
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">
                      <strong>Dawn:</strong> <code>sections/cart-drawer.liquid</code> → caută
                      <code> name=&quot;checkout&quot;</code>
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      <strong>Debut:</strong> <code>sections/cart-template.liquid</code>
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      <strong>Impulse / Prestige:</strong> <code>sections/cart.liquid</code>
                    </Text>
                  </BlockStack>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Notă despre curieriă</Text>
                  <Text variant="bodyMd" tone="subdued">
                    Widgetul cart drawer folosește aceleași puncte de ridicare sincronizate ca
                    widgetul de pe pagina de coș. Datele de livrare (curier ales, punct de
                    ridicare) sunt salvate automat în atributele coșului ca{" "}
                    <code>_rc_method</code>, <code>_rc_courier</code>,{" "}
                    <code>_rc_point_id</code> etc.
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
