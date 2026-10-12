import "@shopify/ui-extensions/preact";
import { render } from "preact";

// Thank you page block: the buyer confirms the order on the merchant's own WhatsApp Business.
// Settings come from the shop metafield $app:picklo / whatsapp_confirm (Picklo → Confirmare WhatsApp).
export default function extension() {
  render(<WhatsAppConfirm />, document.body);
}

const COD_TYPES = new Set(["paymentOnDelivery", "manualPayment"]);

function config() {
  const entry = (shopify.appMetafields?.value || []).find(
    (e) => e.metafield?.key === "whatsapp_confirm" && (!e.target?.type || e.target.type === "shop"),
  );
  if (!entry) return null;
  try { return JSON.parse(entry.metafield.value); } catch { return null; }
}

// Only for cash on delivery when the merchant asks for it; unknown payment type still shows
function isCashOnDelivery() {
  const options = shopify.selectedPaymentOptions?.value || [];
  if (!options.length) return true;
  return options.some((o) => COD_TYPES.has(o.type));
}

function money(cost) {
  if (!cost?.amount) return "";
  const n = Number(cost.amount);
  return `${Number.isFinite(n) ? n.toFixed(2) : cost.amount} ${cost.currencyCode || ""}`.trim();
}

function WhatsAppConfirm() {
  const c = config();
  if (!c?.enabled || !c.phone) return null;
  if (c.codOnly && !isCashOnDelivery()) return null;

  const code = shopify.orderConfirmation?.value?.number || "";
  const total = money(shopify.cost?.totalAmount?.value);
  const text = String(c.message || "")
    .replaceAll("{cod}", code).replaceAll("{magazin}", c.name || "").replaceAll("{total}", total)
    .replace(/\s+/g, " ").trim();
  const ro = (shopify.localization?.language?.value?.isoCode || "ro").startsWith("ro");
  const href = `https://wa.me/${c.phone}?text=${encodeURIComponent(text)}`;

  return (
    <s-section heading={c.title}>
      <s-stack gap="base">
        <s-text>{c.text}</s-text>
        {code ? <s-text color="subdued">{`${ro ? "Cod comandă" : "Order code"}: ${code}`}</s-text> : null}
        <s-button href={href} target="_blank" variant="primary" inlineSize="fill">{c.button}</s-button>
      </s-stack>
    </s-section>
  );
}
