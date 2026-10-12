// Order confirmation on WhatsApp (Thank you page block). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsappPhone, renderWhatsappMessage, whatsappLink, whatsappBlockConfig, WHATSAPP_DEFAULTS } from "../app/utils/whatsapp-confirm.js";

test("phone: Romanian and international formats become wa.me digits", () => {
  assert.equal(normalizeWhatsappPhone("0761 034 629"), "40761034629");
  assert.equal(normalizeWhatsappPhone("+40 761-034-629"), "40761034629");
  assert.equal(normalizeWhatsappPhone("0040761034629"), "40761034629");
  assert.equal(normalizeWhatsappPhone("+36 30 123 4567"), "36301234567");
  assert.equal(normalizeWhatsappPhone("0761"), null);
  assert.equal(normalizeWhatsappPhone(""), null);
});

test("message: placeholders filled, default when empty", () => {
  assert.equal(renderWhatsappMessage("Confirm {cod} de la {magazin}, total {total}", { cod: "XJ7KA2B9", magazin: "AMA Beauty", total: "149.90 RON" }),
    "Confirm XJ7KA2B9 de la AMA Beauty, total 149.90 RON");
  assert.match(renderWhatsappMessage("", { cod: "A1", magazin: "M" }), /A1.*M/);
  assert.equal(whatsappLink("40761034629", "Bună ziua & mersi"), "https://wa.me/40761034629?text=Bun%C4%83%20ziua%20%26%20mersi");
});

test("block config: off without a phone, defaults and shop name fill the gaps", () => {
  assert.equal(whatsappBlockConfig({ whatsappConfirm: true }).enabled, false);
  const c = whatsappBlockConfig({ whatsappConfirm: true, whatsappPhone: "40761034629" }, "AMA Beauty");
  assert.deepEqual([c.enabled, c.name, c.button, c.codOnly], [true, "AMA Beauty", WHATSAPP_DEFAULTS.button, true]);
  assert.equal(whatsappBlockConfig({ whatsappConfirm: true, whatsappPhone: "1", whatsappCodOnly: false }).codOnly, false);
});
