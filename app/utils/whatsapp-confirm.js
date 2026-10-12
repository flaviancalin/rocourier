// app/utils/whatsapp-confirm.js — order confirmation on WhatsApp, shared by the settings page,
// the server and tests. The Thank you page block reads the same config from a shop metafield.

export const WHATSAPP_DEFAULTS = {
  title: "Confirmă comanda pe WhatsApp",
  text: "Trimite-ne un mesaj pe WhatsApp ca să confirmi comanda, iar noi o pregătim imediat.",
  button: "Confirmă pe WhatsApp",
  message: "Bună! Confirm comanda cu codul {cod} de la {magazin}.",
};

// Placeholders the merchant can use in the prefilled message
export const WHATSAPP_PLACEHOLDERS = ["{cod}", "{magazin}", "{total}"];

// "0761 034 629", "+40 761 034 629", "0040761034629" → "40761034629"; null when it can't be a number
export function normalizeWhatsappPhone(input, defaultCountry = "40") {
  let d = String(input || "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  d = d.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function renderWhatsappMessage(template, { cod = "", magazin = "", total = "" } = {}) {
  return String(template || WHATSAPP_DEFAULTS.message)
    .replaceAll("{cod}", cod).replaceAll("{magazin}", magazin).replaceAll("{total}", total)
    .replace(/\s+/g, " ").trim();
}

export const whatsappLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

// What the Thank you page block needs, stored as JSON in the $app:picklo / whatsapp_confirm metafield
export function whatsappBlockConfig(s, shopName = "") {
  return {
    enabled: !!(s?.whatsappConfirm && s?.whatsappPhone),
    phone: s?.whatsappPhone || "",
    name: s?.whatsappName || shopName || "",
    title: s?.whatsappTitle || WHATSAPP_DEFAULTS.title,
    text: s?.whatsappText || WHATSAPP_DEFAULTS.text,
    button: s?.whatsappButton || WHATSAPP_DEFAULTS.button,
    message: s?.whatsappMessage || WHATSAPP_DEFAULTS.message,
    codOnly: s?.whatsappCodOnly !== false,
  };
}
