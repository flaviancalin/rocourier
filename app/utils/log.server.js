// app/utils/log.server.js
// Structured error logging — swap body for Sentry/Datadog when ready.

export function logError(context, error, extra = {}) {
  console.error(JSON.stringify({
    level:   "error",
    context,
    message: error?.message || String(error),
    stack:   error?.stack?.split("\n").slice(0, 4).join(" | "),
    ...extra,
    ts: new Date().toISOString(),
  }));
}

export function logInfo(context, message, extra = {}) {
  console.log(JSON.stringify({
    level: "info",
    context,
    message,
    ...extra,
    ts: new Date().toISOString(),
  }));
}
