// app/routes/auth.$.jsx
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  throw await authenticate.admin(request);
};
