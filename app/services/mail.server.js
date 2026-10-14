// app/services/mail.server.js — transactional email (withdrawal confirmations, pickup reminders).
// Sends through Resend when RESEND_API_KEY and MAIL_FROM are set; otherwise reports that
// email is not configured so callers can record it instead of failing.
const RESEND_URL = "https://api.resend.com/emails";

export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

// → { sent: true, id } | { sent: false, reason }
export async function sendMail({ to, subject, html, text, replyTo, fromName }) {
  if (!to) return { sent: false, reason: "missing_recipient" };
  if (!mailConfigured()) return { sent: false, reason: "not_configured" };
  const from = fromName ? `${fromName.replace(/[<>"]/g, "")} <${process.env.MAIL_FROM}>` : process.env.MAIL_FROM;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: body?.message || `HTTP ${res.status}` };
    return { sent: true, id: body.id };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}
