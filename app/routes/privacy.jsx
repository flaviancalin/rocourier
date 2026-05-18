// app/routes/privacy.jsx
// Public privacy policy page — no auth required
// Accessible at: https://rocourier-production.up.railway.app/privacy
// Register this URL in: Shopify Partner Dashboard → App Setup → Privacy policy URL

export const meta = () => [{ title: "Privacy Policy — Picklo" }];

// No auth — fully public
export async function loader() {
  return null;
}

export default function PrivacyPolicy() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.meta}>Last updated: May 2026</p>

        <p>
          This Privacy Policy explains how <strong>Flash Stations</strong>{" "}
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) collects, uses, and protects
          personal data when you use the <strong>Picklo</strong> Shopify application
          (&ldquo;the App&rdquo;).
        </p>

        <h2 style={styles.h2}>1. Who We Are</h2>
        <p>
          <strong>Flash Stations</strong><br />
          Strada Dan Defleury, Dolj County, Romania<br />
          Contact: <a href="mailto:theflashstations@gmail.com">theflashstations@gmail.com</a>
        </p>

        <h2 style={styles.h2}>2. What Data We Collect</h2>
        <p>When a merchant installs Picklo, we collect and store the following data:</p>
        <ul style={styles.ul}>
          <li><strong>Order data:</strong> Shopify order ID, order name, order total, creation date.</li>
          <li><strong>Customer shipping data:</strong> recipient name, phone number, email address, shipping address (street, city, county, postal code, country).</li>
          <li><strong>Shipping preference:</strong> selected courier, selected delivery method (home delivery or pickup point), selected pickup point name and address.</li>
          <li><strong>AWB data:</strong> generated shipping label numbers (AWB), shipping status.</li>
          <li><strong>Merchant settings:</strong> API credentials for courier services (FAN Courier, Sameday, Cargus, GLS, Packeta), sender address, default shipping preferences. Credentials are stored encrypted at rest.</li>
        </ul>
        <p>We do <strong>not</strong> collect payment card data, bank details, or any sensitive financial information.</p>

        <h2 style={styles.h2}>3. How We Use This Data</h2>
        <ul style={styles.ul}>
          <li>To generate shipping labels (AWBs) with the selected courier on behalf of the merchant.</li>
          <li>To display order and shipping information in the merchant&rsquo;s Picklo dashboard.</li>
          <li>To show pickup point locations to end customers during checkout.</li>
          <li>To track shipment status and display tracking events.</li>
        </ul>
        <p>We do <strong>not</strong> sell personal data. We do not use customer data for advertising or profiling.</p>

        <h2 style={styles.h2}>4. Data Sharing — Third-Party Couriers</h2>
        <p>
          To generate a shipping label, we transmit the recipient&rsquo;s name, phone, email, and
          shipping address to the courier API selected by the merchant. The relevant processors are:
        </p>
        <ul style={styles.ul}>
          <li><strong>FAN Courier</strong> — fan.ro</li>
          <li><strong>Sameday</strong> — sameday.ro</li>
          <li><strong>Cargus</strong> — cargus.ro</li>
          <li><strong>GLS Romania</strong> — gls-romania.ro</li>
          <li><strong>Packeta</strong> — packeta.com</li>
        </ul>
        <p>
          Each courier processes data under their own privacy policy. Picklo transmits only the
          minimum data required to create a shipment.
        </p>

        <h2 style={styles.h2}>5. Data Retention</h2>
        <p>
          Order and customer data is retained as long as the merchant&rsquo;s store has the app
          installed. Upon app uninstallation, all merchant and customer data is deleted within 48
          hours of receiving Shopify&rsquo;s <em>shop/redact</em> webhook.
        </p>
        <p>
          Individual customer data is deleted upon request, in response to Shopify&rsquo;s
          <em>customers/redact</em> webhook. Personal fields are anonymised while AWB records are
          retained for accounting and legal compliance.
        </p>

        <h2 style={styles.h2}>6. Your Rights (GDPR)</h2>
        <p>If you are a resident of the European Economic Area, you have the right to:</p>
        <ul style={styles.ul}>
          <li>Access the personal data we hold about you.</li>
          <li>Request correction of inaccurate data.</li>
          <li>Request deletion of your personal data.</li>
          <li>Object to or restrict processing of your data.</li>
          <li>Lodge a complaint with a supervisory authority.</li>
        </ul>
        <p>
          To exercise these rights, contact us at{" "}
          <a href="mailto:theflashstations@gmail.com">theflashstations@gmail.com</a>.
        </p>

        <h2 style={styles.h2}>7. Security</h2>
        <p>
          Data is stored in a hosted PostgreSQL database with encrypted connections (TLS). API
          credentials provided by merchants are stored encrypted at rest. We apply
          industry-standard security practices to prevent unauthorised access.
        </p>

        <h2 style={styles.h2}>8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted at this URL
          with an updated &ldquo;Last updated&rdquo; date. Continued use of the App after changes
          constitutes acceptance of the updated policy.
        </p>

        <h2 style={styles.h2}>9. Contact</h2>
        <p>
          For any privacy-related questions, contact us at{" "}
          <a href="mailto:theflashstations@gmail.com">theflashstations@gmail.com</a>.
        </p>

        <p style={styles.footer}>
          &copy; {new Date().getFullYear()} Flash Stations. All rights reserved.
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
    background: "#f9fafb",
    minHeight: "100vh",
    padding: "40px 16px",
    color: "#111",
  },
  container: {
    maxWidth: 760,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 8,
    padding: "48px 56px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  h1: { fontSize: 28, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 },
  meta: { color: "#6b7280", fontSize: 14, marginBottom: 24 },
  ul: { paddingLeft: 24, lineHeight: 1.8 },
  footer: { marginTop: 48, color: "#9ca3af", fontSize: 13, borderTop: "1px solid #e5e7eb", paddingTop: 16 },
};
