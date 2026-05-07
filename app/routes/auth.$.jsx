// app/routes/auth.$.jsx
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch (e) {
    if (e instanceof Response) throw e; // SDK redirects — always re-throw
    throw e;
  }
  return null;
};
