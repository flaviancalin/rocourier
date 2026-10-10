// app/services/activity.server.js
// Activity log: a readable history of what happened to each order (who, what, when).
// Logging never throws — a failed log line must not break the action it describes.
import { prisma } from "../db.server.js";

export async function logActivity({ shop, order = null, action, message, actor = null }) {
  try {
    await prisma.activityLog.create({
      data: {
        shop,
        orderId: order?.id || null,
        orderName: order?.shopifyOrderName || null,
        action,
        message: String(message).slice(0, 1000),
        actor,
      },
    });
  } catch (e) {
    console.error("[Activity] log failed:", e.message);
  }
}

export async function listActivity(shop, { orderId = null, take = 100, cursor = null } = {}) {
  return prisma.activityLog.findMany({
    where: { shop, ...(orderId ? { orderId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}
