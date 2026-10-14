import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// "Withdraw from contract" on every order in the customer account. It links to the store's
// withdrawal page (app proxy), which recognises the signed-in customer and the order.
export default function extension() {
  render(<WithdrawAction />, document.body);
}

const LABELS = { ro: "Retragere din contract", en: "Withdraw from contract", de: "Vertrag widerrufen", hu: "Elállás a szerződéstől", cs: "Odstoupit od smlouvy" };

// The session token's "dest" claim is the shop's myshopify domain
function shopFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return new URL(payload.dest).host;
  } catch {
    return "";
  }
}

function WithdrawAction() {
  const [href, setHref] = useState("");
  const lang = (shopify.localization?.language?.value?.isoCode || "ro").slice(0, 2).toLowerCase();

  useEffect(() => {
    let alive = true;
    shopify.sessionToken.get().then((token) => {
      const host = shopFromToken(token);
      const oid = String(shopify.orderId || "").split("/").pop();
      if (alive && host && oid) setHref(`https://${host}/apps/rocourier/withdraw?oid=${encodeURIComponent(oid)}&lang=${encodeURIComponent(lang)}`);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!href) return null;
  return <s-button href={href}>{LABELS[lang] || LABELS.ro}</s-button>;
}
