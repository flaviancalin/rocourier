// app/routes/terms.jsx
// Public Terms of Service page — no auth required
// Accessible at: https://rocourier-production.up.railway.app/terms
// Register this URL in: Shopify Partner Dashboard → App Setup → Terms of service URL

export const meta = () => [{ title: "Terms of Service — Picklo" }];

// No auth — fully public
export async function loader() {
  return null;
}

export default function TermsOfService() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Last updated: April 2025</p>

        <p>
          Please read these Terms of Service (&ldquo;Terms&rdquo;) carefully before using the{" "}
          <strong>Picklo</strong> Shopify application (&ldquo;the App&rdquo;) operated by{" "}
          <strong>TODO: Your Company Name</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;).
        </p>
        <p>
          By installing or using the App, you agree to be bound by these Terms. If you do not
          agree, do not install or use the App.
        </p>

        <h2 style={styles.h2}>1. Description of Service</h2>
        <p>
          Picklo is a Shopify application that enables merchants to:
        </p>
        <ul style={styles.ul}>
          <li>Display a courier and pickup-point selector widget to customers during checkout.</li>
          <li>Generate shipping labels (AWBs) with Romanian courier services (FAN Courier, Sameday, Cargus, GLS, Packeta).</li>
          <li>Manage and track shipments from within the Shopify admin.</li>
        </ul>

        <h2 style={styles.h2}>2. Eligibility</h2>
        <p>
          The App is intended for use by Shopify merchants operating in Romania or shipping to
          Romania. By using the App you confirm that you have the legal authority to enter into
          this agreement on behalf of your business.
        </p>

        <h2 style={styles.h2}>3. Merchant Responsibilities</h2>
        <ul style={styles.ul}>
          <li>
            You are responsible for providing valid API credentials for the courier services you
            wish to use. We are not responsible for errors caused by incorrect or expired credentials.
          </li>
          <li>
            You are responsible for ensuring your use of courier services complies with each
            courier&rsquo;s own terms and conditions.
          </li>
          <li>
            You are responsible for the accuracy of sender address and settings configured in the App.
          </li>
          <li>
            You must not use the App for any unlawful purpose or in violation of Shopify&rsquo;s
            Partner Program policies.
          </li>
        </ul>

        <h2 style={styles.h2}>4. Third-Party Services</h2>
        <p>
          The App integrates with third-party courier APIs (FAN Courier, Sameday, Cargus, GLS,
          Packeta). We do not control these services and are not liable for their availability,
          accuracy, pricing, or any fees they charge. Any contractual relationship for courier
          services is directly between you and the courier.
        </p>

        <h2 style={styles.h2}>5. Intellectual Property</h2>
        <p>
          All content, features, and functionality of the App are the exclusive property of
          TODO: Your Company Name and are protected by applicable intellectual property laws. You
          may not copy, modify, distribute, or reverse-engineer any part of the App.
        </p>

        <h2 style={styles.h2}>6. Disclaimer of Warranties</h2>
        <p>
          The App is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without any
          warranty of any kind, express or implied, including but not limited to warranties of
          merchantability, fitness for a particular purpose, or non-infringement. We do not
          warrant that the App will be uninterrupted, error-free, or that defects will be
          corrected.
        </p>

        <h2 style={styles.h2}>7. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, TODO: Your Company Name shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages, including lost
          profits or data, arising from your use of or inability to use the App, even if we have
          been advised of the possibility of such damages.
        </p>
        <p>
          Our total liability for any claim arising from your use of the App shall not exceed the
          fees you paid us in the three months preceding the claim.
        </p>

        <h2 style={styles.h2}>8. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your access to the App at any time, with
          or without notice, for conduct that we believe violates these Terms or is harmful to
          other users, us, third parties, or for any other reason at our sole discretion.
        </p>
        <p>
          You may terminate your use of the App at any time by uninstalling it from your Shopify
          store. Upon uninstallation, your data will be deleted in accordance with our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2 style={styles.h2}>9. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. Changes will be posted at this
          URL with an updated &ldquo;Last updated&rdquo; date. Your continued use of the App
          after changes constitutes your acceptance of the new Terms.
        </p>

        <h2 style={styles.h2}>10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of Romania. Any disputes shall be subject to the
          exclusive jurisdiction of the courts of TODO: City, Romania.
        </p>

        <h2 style={styles.h2}>11. Contact</h2>
        <p>
          For any questions about these Terms, contact us at{" "}
          <a href="mailto:TODO@yourdomain.com">TODO@yourdomain.com</a>.
        </p>

        <p style={styles.footer}>
          &copy; {new Date().getFullYear()} TODO: Your Company Name. All rights reserved.
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
