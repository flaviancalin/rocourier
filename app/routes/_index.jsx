// app/routes/_index.jsx
// Root route — redirects to /app preserving Shopify query params (shop, host, etc.)
import { redirect } from "@remix-run/node";

export async function loader({ request }) {
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  return redirect(params ? `/app?${params}` : "/app");
}
