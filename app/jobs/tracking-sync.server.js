// app/jobs/tracking-sync.server.js
// Background job: polls every courier for AWB status updates.
// Called by the cron scheduler in entry.server.js every hour.
import { prisma } from "../db.server.js";
import { refreshOrderTracking, hasTrackingCredentials, TERMINAL_STATUSES } from "../services/tracking.server.js";

const PER_SHOP_LIMIT = 50; // oldest-updated first, so every order gets its turn

export async function syncTrackingForAllShops() {
  const startedAt = Date.now();
  console.log(`[TrackingSync] Starting at ${new Date().toISOString()}`);

  const shops = await prisma.order.groupBy({
    by: ["shop"],
    where: { awbNumber: { not: null }, awbStatus: { notIn: ["pending", ...TERMINAL_STATUSES] } },
  });

  let totalUpdated = 0;
  for (const { shop } of shops) {
    try {
      const settings = await prisma.shopSettings.findUnique({ where: { shop } });
      if (settings) totalUpdated += await syncTrackingForShop(settings);
    } catch (e) {
      console.error(`[TrackingSync] Error for shop ${shop}:`, e.message);
    }
  }

  console.log(`[TrackingSync] Done in ${Date.now() - startedAt}ms — ${totalUpdated} orders updated`);
  return totalUpdated;
}

async function syncTrackingForShop(settings) {
  const orders = await prisma.order.findMany({
    where: {
      shop: settings.shop,
      awbNumber: { not: null },
      awbStatus: { notIn: ["pending", ...TERMINAL_STATUSES] },
    },
    take: PER_SHOP_LIMIT,
    orderBy: { updatedAt: "asc" },
  });

  let updated = 0;
  for (const order of orders) {
    if (!hasTrackingCredentials(order.courierType, settings)) continue;
    try {
      const { changed } = await refreshOrderTracking(order, settings, { actor: "tracking" });
      if (changed) updated++;
      // Touch the row so the next run starts with other orders
      else await prisma.order.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
    } catch (e) {
      console.error(`[TrackingSync] Error tracking AWB ${order.awbNumber}:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return updated;
}
