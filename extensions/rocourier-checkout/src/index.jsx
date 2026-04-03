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

  const method    = attrVal(attributes, "_rc_method");
  const courier   = attrVal(attributes, "_rc_courier");
  const pointName = attrVal(attributes, "_rc_point_name");
  const pointAddr = attrVal(attributes, "_rc_point_address");

  // Only render under the selected rate
  if (!isTargetSelected) return null;

  // Show pickup point details if customer chose a locker
  if (method === "pickup_point" && pointName) {
    const courierLabel = courier === "fan" ? "FANbox" : "Sameday easybox";
    return (
      <BlockStack spacing="extraTight" padding={["none", "none", "base", "none"]}>
        <Divider />
        <InlineStack spacing="tight" blockAlignment="center">
          <Text size="small" emphasis="bold">📦 Punct de ridicare:</Text>
          <Text size="small" emphasis="bold">{courierLabel} — {pointName}</Text>
        </InlineStack>
        {pointAddr ? (
          <Text size="small" appearance="subdued">{pointAddr}</Text>
        ) : null}
      </BlockStack>
    );
  }

  // Show courier for home delivery
  if (method === "home_delivery" && courier) {
    const courierLabel = courier === "fan" ? "FAN Courier" : "Sameday Courier";
    return (
      <BlockStack spacing="extraTight" padding={["none", "none", "base", "none"]}>
        <Divider />
        <Text size="small" appearance="subdued">🚚 Livrare prin {courierLabel}</Text>
      </BlockStack>
    );
  }

  return null;
}

function attrVal(attributes, key) {
  const attr = attributes?.find?.((a) => a.key === key);
  return attr?.value || "";
}
