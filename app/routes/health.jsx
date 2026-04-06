// app/routes/health.jsx
// Simple health check endpoint for Railway / Render / load balancers.
// Returns 200 if the app + DB are reachable.

import { json } from "@remix-run/node";
import { prisma } from "../db.server.js";

export async function loader() {
  try {
    // Quick DB ping
    await prisma.$queryRaw`SELECT 1`;
    return json({
      status: "ok",
      app: "Picklo",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return json(
      { status: "error", error: e.message },
      { status: 503 }
    );
  }
}
