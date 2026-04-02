// app/routes/auth.login.jsx
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server.js";

export async function loader({ request }) {
  const result = await login(request);
  // login() throws a redirect if shop param is present and valid
  // If we get here, no shop param was provided
  return json(result ?? {});
}

export async function action({ request }) {
  const result = await login(request);
  return json(result ?? {});
}

export default function AuthLogin() {
  const data = useLoaderData();
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
        <p style={{ color: "#666", marginBottom: 24 }}>
          Enter your Shopify store domain to install the app:
        </p>
        <Form method="post">
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
          {data?.errors?.shop && (
            <p style={{ color: "red", marginBottom: 8 }}>{data.errors.shop}</p>
          )}
          <button type="submit" style={{
            width: "100%", padding: "10px 0", background: "#008060",
            color: "#fff", border: "none", borderRadius: 6,
            fontSize: 15, cursor: "pointer", fontWeight: 600,
          }}>
            Install App
          </button>
        </Form>
      </div>
    </div>
  );
}
