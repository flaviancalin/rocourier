// app/routes/auth.login.jsx
// Shopify Remix scaffold — fallback auth page for direct installs.
// Required by @shopify/shopify-app-remix; do not publicly promote this URL.
// Installation must be initiated from the Shopify App Store or Partner Dashboard.
import { login } from "../shopify.server.js";

export const loader = async ({ request }) => {
  return login(request);
};

export const action = async ({ request }) => {
  return login(request);
};

export default function AuthLogin() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#f6f6f7", fontFamily: "sans-serif",
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 40,
        boxShadow: "0 2px 16px rgba(0,0,0,0.10)", maxWidth: 400, width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{ marginBottom: 8, fontSize: 22 }}>Picklo</h1>
        <p style={{ color: "#6b7280", fontSize: 15, marginBottom: 24, lineHeight: 1.6 }}>
          To install Picklo, visit the Shopify App Store and click <strong>Install</strong> from your store.
        </p>
        <a
          href="https://apps.shopify.com/picklo"
          style={{
            display: "inline-block", padding: "10px 24px", background: "#008060",
            color: "#fff", borderRadius: 6, fontSize: 15, fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Go to Shopify App Store
        </a>
      </div>
    </div>
  );
}
