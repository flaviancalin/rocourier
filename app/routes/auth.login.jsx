// app/routes/auth.login.jsx
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
      }}>
        <h1 style={{ marginBottom: 8 }}>🚚 RoCourier</h1>
        <form method="post">
          <input
            type="text"
            name="shop"
            placeholder="your-store.myshopify.com"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 6,
              border: "1px solid #ccc", fontSize: 15, marginBottom: 12,
              boxSizing: "border-box",
            }}
            required
          />
          <button type="submit" style={{
            width: "100%", padding: "10px 0", background: "#008060",
            color: "#fff", border: "none", borderRadius: 6,
            fontSize: 15, cursor: "pointer", fontWeight: 600,
          }}>
            Install App
          </button>
        </form>
      </div>
    </div>
  );
}
