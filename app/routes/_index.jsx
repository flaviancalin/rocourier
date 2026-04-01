// app/routes/_index.jsx
// Root route — redirects to /app (the embedded admin dashboard)
import { redirect } from "@remix-run/node";

export async function loader() {
  return redirect("/app");
}
