import "@shopify/ui-extensions/preact";
import { render } from "preact";

const POINT_LABELS = {
  fan: "FANbox", sameday: "Sameday easybox", cargus: "Cargus Ship & Go",
  gls: "GLS ParcelShop", packeta: "Packeta / Z-BOX", dpd: "DPDbox / Punct DPD",
};

export default function extension() {
  render(<PickupPointSummary />, document.body);
}

function attr(key) {
  return (shopify.attributes?.value || []).find((a) => a.key === key)?.value || "";
}

// Locker chosen in the cart widget, or the locker rate picked in checkout. On the
// Thank you page the option may lack its code or selection, so the locker title
// ("FANbox — …") and a single remaining option are accepted too.
function chosenPoint() {
  if (attr("_rc_method") === "pickup_point" && attr("_rc_point_name")) {
    return {
      label: POINT_LABELS[attr("_rc_courier")] || "",
      name: attr("_rc_point_name"),
      address: attr("_rc_point_address"),
    };
  }
  const lockerTitle = new RegExp(`^(${Object.values(POINT_LABELS).map((l) => l.replace(/[/]/g, "\\/")).join("|")}) — `);
  for (const group of shopify.deliveryGroups?.value || []) {
    const options = group.deliveryOptions || [];
    const handle = group.selectedDeliveryOption?.handle;
    const option = options.find((o) => o.handle === handle) || (options.length === 1 ? options[0] : null);
    if (option && (option.code?.startsWith("RC_PP_") || lockerTitle.test(option.title || ""))) {
      return { label: "", name: option.title || "", address: option.description || "" };
    }
  }
  return null;
}

function PickupPointSummary() {
  const point = chosenPoint();
  if (!point) return null;
  const ro = (shopify.localization?.language?.value?.isoCode || "").startsWith("ro");
  return (
    <s-section heading={ro ? "Ridicare din punct" : "Pickup point"}>
      <s-stack gap="small-300">
        <s-text type="strong">{point.label ? `${point.label} — ${point.name}` : point.name}</s-text>
        {point.address ? <s-text color="subdued">{point.address}</s-text> : null}
        <s-text color="subdued">
          {ro ? "Vei primi un SMS cu codul de ridicare când coletul ajunge." : "You'll get a text message with the pickup code when your parcel arrives."}
        </s-text>
      </s-stack>
    </s-section>
  );
}
