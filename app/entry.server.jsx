// app/entry.server.jsx
// Remix server entry point — also starts the tracking cron job.

import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server.js";

// ─── Tracking sync cron ───────────────────────────────────────────────────────
// Runs only in the server process, not during client-side rendering.
// Polls courier APIs every 60 minutes for AWB status updates.
let cronStarted = false;

async function startTrackingCron() {
  if (cronStarted || process.env.NODE_ENV !== "production") return;
  cronStarted = true;

  // Lazy import to avoid loading DB clients during build
  const { syncTrackingForAllShops } = await import("./jobs/tracking-sync.server.js");

  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  // Run immediately on startup (after 30s delay to let the server warm up)
  setTimeout(async () => {
    try { await syncTrackingForAllShops(); } catch (e) { console.error("[Cron]", e); }
  }, 30_000);

  // Then run every hour
  setInterval(async () => {
    try { await syncTrackingForAllShops(); } catch (e) { console.error("[Cron]", e); }
  }, INTERVAL_MS);

  console.log("[Cron] Tracking sync scheduled every 60 minutes");
}

// Start cron when server boots
startTrackingCron().catch(console.error);

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
