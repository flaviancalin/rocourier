// app/services/support.server.js
// Support tickets between merchants (Picklo → Ajutor) and the Picklo team (/hq).
import { prisma } from "../db.server.js";

import { CATEGORIES, STATUSES } from "../utils/support.js";
export { CATEGORIES, STATUSES };

const clean = (s, max) => String(s || "").trim().slice(0, max);

export async function createTicket(shop, { subject, category, body, contactName, contactEmail }) {
  const text = clean(body, 10000);
  if (!clean(subject, 200)) throw new Error("Scrie un subiect.");
  if (text.length < 5) throw new Error("Descrie pe scurt ce s-a întâmplat.");
  return prisma.supportTicket.create({
    data: {
      shop, subject: clean(subject, 200), category: CATEGORIES[category] ? category : "question",
      priority: category === "problem" ? "high" : "normal",
      contactName: clean(contactName, 120) || null, contactEmail: clean(contactEmail, 200) || null,
      unreadByTeam: true,
      messages: { create: { author: "merchant", authorName: clean(contactName, 120) || shop, body: text } },
    },
  });
}

// Merchant replies on their own ticket (re-opens it).
export async function merchantReply(shop, ticketId, body, authorName = null) {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, shop } });
  if (!ticket) throw new Error("Tichetul nu există.");
  const text = clean(body, 10000);
  if (!text) throw new Error("Mesajul e gol.");
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId, author: "merchant", authorName: authorName || ticket.contactName || shop, body: text } }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { status: "open", unreadByTeam: true, lastMessageAt: new Date() } }),
  ]);
}

// Team reply (visible to the merchant) or internal note.
export async function teamReply(ticketId, member, body, { internal = false, status = null } = {}) {
  const text = clean(body, 10000);
  if (!text) throw new Error("Mesajul e gol.");
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId, author: "team", authorName: member.name, body: text, internal } }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        unreadByTeam: false,
        ...(internal ? {} : { unreadByMerchant: true, lastMessageAt: new Date(), status: status || "waiting_merchant" }),
        ...(internal && status ? { status } : {}),
      },
    }),
  ]);
}

export async function merchantTickets(shop) {
  return prisma.supportTicket.findMany({
    where: { shop }, orderBy: { lastMessageAt: "desc" }, take: 50,
    include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } },
  });
}

export async function markReadByMerchant(shop, ticketId) {
  await prisma.supportTicket.updateMany({ where: { id: ticketId, shop }, data: { unreadByMerchant: false } });
}

export async function unreadForMerchant(shop) {
  return prisma.supportTicket.count({ where: { shop, unreadByMerchant: true } });
}
