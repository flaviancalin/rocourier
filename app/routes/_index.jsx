// app/routes/_index.jsx
// Root route — redirects to /app (the embedded admin dashboard)
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";

export async function loader({ request }) {
  await authenticate.admin(request);
  return redirect("/app");
}
