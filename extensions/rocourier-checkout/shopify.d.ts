import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/index.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.shipping-option-item.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ThankYou.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
