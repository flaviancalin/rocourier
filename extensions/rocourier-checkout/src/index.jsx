import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useAttributeValues } from "@shopify/ui-extensions/checkout/preact";

const COURIER_LABELS = {
  fan:     { home: "FAN Courier",     pickup: "FANbox"           },
  sameday: { home: "Sameday Courier", pickup: "Sameday easybox"  },
  cargus:  { home: "Cargus",          pickup: "Cargus Ship & Go" },
  gls:     { home: "GLS",             pickup: "GLS ParcelShop"   },
  packeta: { home: "Packeta",         pickup: "Packeta / Z-BOX"  },
  dpd:     { home: "DPD",             pickup: "DPDbox / Punct DPD" },
};

export default function extension() {
  render(<PickloOptionDetails />, document.body);
}

function PickloOptionDetails() {
  const [method, courier, pointName, pointAddr] = useAttributeValues([
    "_rc_method", "_rc_courier", "_rc_point_name", "_rc_point_address",
  ]);

  // Only render under the selected rate
  if (!shopify.isTargetSelected.value || !method) return null;

  const labels = COURIER_LABELS[courier] || { home: courier, pickup: courier };

  if (method === "pickup_point" && pointName) {
    return (
      <s-stack gap="small-500" paddingBlockEnd="base">
        <s-divider></s-divider>
        <s-text type="strong">Pickup: {labels.pickup} — {pointName}</s-text>
        {pointAddr ? <s-text color="subdued">{pointAddr}</s-text> : null}
      </s-stack>
    );
  }

  if (method === "home_delivery" && courier) {
    return (
      <s-stack gap="small-500" paddingBlockEnd="base">
        <s-divider></s-divider>
        <s-text color="subdued">{labels.home}</s-text>
      </s-stack>
    );
  }

  return null;
}
