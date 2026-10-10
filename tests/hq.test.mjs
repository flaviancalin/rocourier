// Team dashboard: password hashing and support ticket rules. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, passwordProblem } from "../app/services/hq-auth.server.js";

test("passwords are salted scrypt hashes and verify only with the right password", () => {
  const a = hashPassword("Picklo-Test-2026x"), b = hashPassword("Picklo-Test-2026x");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$/);
  assert.equal(verifyPassword("Picklo-Test-2026x", a), true);
  assert.equal(verifyPassword("picklo-test-2026x", a), false);
  assert.equal(verifyPassword("x", "garbage"), false);
  assert.ok(passwordProblem("scurt1"));
  assert.ok(passwordProblem("doarliteresifaracifre"));
  assert.equal(passwordProblem("Ana-Suport-2026"), null);
});

test("tickets: merchant creates, team replies, internal notes stay hidden", async () => {
  const { prisma } = await import("../app/db.server.js");
  const { createTicket, teamReply, merchantTickets, merchantReply } = await import("../app/services/support.server.js");
  const shop = `support-test-${Date.now()}.myshopify.com`;
  try {
    await assert.rejects(createTicket(shop, { subject: "", body: "ceva" }), /subiect/);
    const t = await createTicket(shop, { subject: "Nu merge", category: "problem", body: "Detalii problemă", contactName: "Ana" });
    assert.equal(t.priority, "high");
    await teamReply(t.id, { name: "Echipa" }, "Notă pentru colegi", { internal: true });
    await teamReply(t.id, { name: "Echipa" }, "Rezolvat, încearcă acum", { status: "resolved" });
    let [mine] = await merchantTickets(shop);
    assert.deepEqual(mine.messages.map((m) => m.author), ["merchant", "team"]);
    assert.equal(mine.status, "resolved");
    assert.equal(mine.unreadByMerchant, true);
    await merchantReply(shop, t.id, "Tot nu merge");
    [mine] = await merchantTickets(shop);
    assert.equal(mine.status, "open");
    assert.equal(mine.unreadByTeam, true);
    await assert.rejects(merchantReply("alt-magazin.myshopify.com", t.id, "x"), /nu există/);
  } finally {
    await prisma.supportTicket.deleteMany({ where: { shop } });
  }
});
