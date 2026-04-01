// app/jobs/tracking-sync.server.js
// Background job: polls FAN Courier & Sameday for AWB status updates.
// Called by the cron scheduler in entry.server.js every hour.
// In production, for high-volume stores consider using a proper queue
// (e.g. BullMQ with Redis) instead of this simple sequential approach.

import { prisma } from "../db.server.js";
import { fanTrackAwb } from "../services/fan-courier.server.js";
import { samedayTrackAwb } from "../services/sameday.server.js";
import { addTrackingEvent } from "../models/order.server.js";

// Map courier event text → our status codes
const FAN_STATUS_MAP = {
  "colet livrat": "delivered",
  "livrat":       "delivered",
  "retur":        "returned",
  "in curs de livrare": "out_for_delivery",
  "la livrare":         "out_for_delivery",
  "in tranzit":         "in_transit",
  "tranzit":            "in_transit",
  "preluat":            "picked_up",
};

const SAMEDAY_STATUS_MAP = {
  "100": "delivered",          // Delivered
  "101": "delivered",
  "200": "returned",           // Returned
  "60":  "out_for_delivery",   // Out for delivery
  "55":  "in_transit",         // In transit
  "10":  "picked_up",          // Picked up by courier
};

function classifyFanStatus(description) {
  const lower = (description || "").toLowerCase();
  for (const [key, status] of Object.entries(FAN_STATUS_MAP)) {
    if (lower.includes(key)) return status;
  }
  return null;
}

function classifySamedayStatus(code) {
  return SAMEDAY_STATUS_MAP[String(code)] || null;
}

// Final statuses — don't poll these anymore
const TERMINAL_STATUSES = new Set(["delivered", "returned", "failed"]);

// ─────────────────────────────────────────────────────────────────────────────
// Main sync function — call this on a schedule
// ─────────────────────────────────────────────────────────────────────────────
export async function syncTrackingForAllShops() {
  const startedAt = Date.now();
  console.log(`[TrackingSync] Starting at ${new Date().toISOString()}`);

  // Get all shops with settings
  const allSettings = await prisma.shopSettings.findMany({
    where: {
      OR: [
        { fanEnabled: true, fanClientId: { not: null } },
        { samedayEnabled: true, samedayUsername: { not: null } },
      ],
    },
  });

  let totalUpdated = 0;

  for (const settings of allSettings) {
    try {
      const updated = await syncTrackingForShop(settings);
      totalUpdated += updated;
    } catch (e) {
      console.error(`[TrackingSync] Error for shop ${settings.shop}:`, e.message);
    }
  }

  console.log(
    `[TrackingSync] Done in ${Date.now() - startedAt}ms — ${totalUpdated} orders updated`
  );
  return totalUpdated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync one shop's orders
// ─────────────────────────────────────────────────────────────────────────────
async function syncTrackingForShop(settings) {
  // Only poll orders with AWBs that aren't in a terminal state
  const orders = await prisma.order.findMany({
    where: {
      shop: settings.shop,
      awbNumber: { not: null },
      awbStatus: { notIn: ["pending", "delivered", "returned", "failed"] },
    },
    take: 50, // max 50 per run to avoid rate limits
    orderBy: { updatedAt: "asc" }, // oldest updated first
  });

  if (orders.length === 0) return 0;

  let updated = 0;

  for (const order of orders) {
    try {
      const events = await fetchTrackingEvents(order, settings);
      if (!events || events.length === 0) continue;

      // Save new events
      for (const event of events) {
        await addTrackingEvent(order.id, event).catch(() => {});
      }

      // Determine new status from most recent event
      const latestEvent = events[0];
      let newStatus = null;

      if (order.courierType === "fan") {
        newStatus = classifyFanStatus(latestEvent.description);
      } else if (order.courierType === "sameday") {
        newStatus = classifySamedayStatus(latestEvent.code);
        if (!newStatus) newStatus = classifyFanStatus(latestEvent.description);
      }

      // Only update if status actually changed and is meaningful
      if (newStatus && newStatus !== order.awbStatus) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            awbStatus: newStatus,
            updatedAt: new Date(),
          },
        });
        console.log(
          `[TrackingSync] ${order.shopifyOrderName} (${order.shop}): ` +
          `${order.awbStatus} → ${newStatus}`
        );
        updated++;
      }

      // Throttle: 200ms between requests to avoid rate limiting
      await sleep(200);

    } catch (e) {
      console.error(
        `[TrackingSync] Error tracking AWB ${order.awbNumber}:`,
        e.message
      );
    }
  }

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch tracking events from courier API
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTrackingEvents(order, settings) {
  if (order.courierType === "fan" && settings.fanClientId) {
    return fanTrackAwb({
      clientId: settings.fanClientId,
      username: settings.fanUsername,
      password: settings.fanPassword,
      awbNumber: order.awbNumber,
    });
  }

  if (order.courierType === "sameday" && settings.samedayUsername) {
    return samedayTrackAwb({
      username: settings.samedayUsername,
      password: settings.samedayPassword,
      awbNumber: order.awbNumber,
    });
  }

  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
