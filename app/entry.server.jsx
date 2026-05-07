// app/entry.server.jsx
// Remix server entry point — also starts the tracking cron job.

import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server.js";

// ─── Cron jobs ────────────────────────────────────────────────────────────────
// Runs only in the server process, not during client-side rendering.
let cronsStarted = false;

async function startCrons() {
  if (cronsStarted || process.env.NODE_ENV !== "production") return;
  cronsStarted = true;

  // ── Tracking sync: every 60 minutes ───────────────────────────────────────
  const { syncTrackingForAllShops } = await import("./jobs/tracking-sync.server.js");

  setTimeout(async () => {
    try { await syncTrackingForAllShops(); } catch (e) { console.error("[Cron/tracking]", e); }
  }, 30_000);

  setInterval(async () => {
    try { await syncTrackingForAllShops(); } catch (e) { console.error("[Cron/tracking]", e); }
  }, 60 * 60 * 1000);

  console.log("[Cron] Tracking sync scheduled every 60 minutes");

  // ── Pickup point sync: every 24 hours ─────────────────────────────────────
  // Uses app-level env var credentials — no merchant settings needed.
  // Runs once 5 minutes after startup so it doesn't block boot, then daily.
  const { refreshPickupPointsCache } = await import("./models/pickup-points.server.js");

  setTimeout(async () => {
    try {
      const r = await refreshPickupPointsCache();
      const total = (r.fan || 0) + (r.sameday || 0) + (r.cargus || 0) + (r.gls || 0) + (r.packeta || 0);
      if (r.errors?.length) console.warn("[Cron/pickups] Errors:", r.errors);
      console.log(`[Cron/pickups] Refreshed ${total} pickup points`);
    } catch (e) { console.error("[Cron/pickups]", e); }
  }, 5 * 60 * 1000);

  setInterval(async () => {
    try {
      const r = await refreshPickupPointsCache();
      const total = (r.fan || 0) + (r.sameday || 0) + (r.cargus || 0) + (r.gls || 0) + (r.packeta || 0);
      if (r.errors?.length) console.warn("[Cron/pickups] Errors:", r.errors);
      console.log(`[Cron/pickups] Refreshed ${total} pickup points`);
    } catch (e) { console.error("[Cron/pickups]", e); }
  }, 24 * 60 * 60 * 1000);

  console.log("[Cron] Pickup point sync scheduled every 24 hours");
}

// Start crons when server boots
startCrons().catch(console.error);

// ─── Remix render ─────────────────────────────────────────────────────────────
const ABORT_DELAY = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  remixContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { abort, pipe } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
