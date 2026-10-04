// app/routes/_index.jsx
// Root route — redirects to /app preserving Shopify query params (shop, host, etc.)
import { useEffect } from "react";
import { redirect } from "@remix-run/node";
import { useLocation, useNavigate } from "@remix-run/react";

export async function loader({ request }) {
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  return redirect(params ? `/app?${params}` : "/app");
}

// App Bridge can sync the embedded frame back to "/" after the server redirect;
// Remix then renders this route client-side, so forward to the dashboard instead
// of showing an empty page.
export default function Index() {
  const navigate = useNavigate();
  const { search } = useLocation();
  useEffect(() => {
    navigate(`/app${search}`, { replace: true });
  }, [navigate, search]);
  return null;
}
