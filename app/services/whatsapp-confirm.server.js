// app/services/whatsapp-confirm.server.js — publishes the WhatsApp confirmation settings to the
// shop metafield the Thank you page block reads ($app:picklo / whatsapp_confirm).
import { whatsappBlockConfig } from "../utils/whatsapp-confirm.js";

export const WHATSAPP_METAFIELD = { namespace: "$app:picklo", key: "whatsapp_confirm" };

export async function syncWhatsappMetafield(admin, settings) {
  const res = await admin.graphql(`{ shop { id name } }`);
  const shop = (await res.json()).data?.shop;
  if (!shop?.id) throw new Error("Nu am putut citi magazinul din Shopify.");
  const config = whatsappBlockConfig(settings, shop.name);
  const set = await admin.graphql(
    `mutation ($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { variables: { m: [{ ownerId: shop.id, ...WHATSAPP_METAFIELD, type: "json", value: JSON.stringify(config) }] } },
  );
  const err = (await set.json()).data?.metafieldsSet?.userErrors?.[0];
  if (err) throw new Error(`Shopify: ${err.message}`);
  return config;
}
