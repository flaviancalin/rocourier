import {
  reactExtension,
  useAttributes,
  useShippingOptionTarget,
  BlockStack,
  InlineStack,
  Text,
  Divider,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.checkout.shipping-option-item.render-after",
  () => <RoCourierOptionDetails />
);

function RoCourierOptionDetails() {
  const { shippingOptionTarget, isTargetSelected } = useShippingOptionTarget();
  const attributes = useAttributes();

  // Only render under the selected rate
  if (!isTargetSelected) return null;

  const method    = attrVal(attributes, "_rc_method");
  const courier   = attrVal(attributes, "_rc_courier");
  const pointName = attrVal(attributes, "_rc_point_name");
  const pointAddr = attrVal(attributes, "_rc_point_address");

  if (!method) return null;

  const COURIER_LABELS = {
    fan:     { home: "FAN Courier",      pickup: "FANbox"            },
    sameday: { home: "Sameday Courier",  pickup: "Sameday easybox"   },
    cargus:  { home: "Cargus",           pickup: "Cargus Ship & Go"  },
    gls:     { home: "GLS",              pickup: "GLS ParcelShop"    },
    packeta: { home: "Packeta",          pickup: "Packeta / Z-BOX"   },
  };

  const labels = COURIER_LABELS[courier] || { home: courier, pickup: courier };

  if (method === "pickup_point" && pointName) {
    return (
      <BlockStack spacing="extraTight" padding={["none", "none", "base", "none"]}>
        <Divider />
        <InlineStack spacing="tight" blockAlignment="center">
          <Text size="small" emphasis="bold">Pickup: {labels.pickup} — {pointName}</Text>
        </InlineStack>
        {pointAddr ? (
          <Text size="small" appearance="subdued">{pointAddr}</Text>
        ) : null}
      </BlockStack>
    );
  }

  if (method === "home_delivery" && courier) {
    return (
      <BlockStack spacing="extraTight" padding={["none", "none", "base", "none"]}>
        <Divider />
        <Text size="small" appearance="subdued">{labels.home}</Text>
      </BlockStack>
    );
  }

  return null;
}

function attrVal(attributes, key) {
  if (!Array.isArray(attributes)) return "";
  const attr = attributes.find((a) => a.key === key);
  return attr?.value || "";
}
