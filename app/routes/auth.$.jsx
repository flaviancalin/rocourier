// app/routes/auth.$.jsx
// Handles ALL /auth/* routes:
//   /auth/login?shop=xxx  → initiates OAuth
//   /auth/callback        → completes OAuth, saves session, redirects to /app
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};
