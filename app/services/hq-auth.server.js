// app/services/hq-auth.server.js
// Login for the Picklo team dashboard (/hq). Separate from Shopify auth: team members
// sign in with email + password; the session lives in a signed, http-only cookie.
// First admin: set HQ_ADMIN_EMAIL + HQ_ADMIN_PASSWORD on the server; the account is
// created the first time someone signs in with exactly those credentials.
import crypto from "node:crypto";
import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { prisma } from "../db.server.js";

const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function sessionSecret() {
  if (process.env.HQ_SESSION_SECRET) return process.env.HQ_SESSION_SECRET;
  // Derived, never the raw app secret; set HQ_SESSION_SECRET in production
  return crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "picklo-dev").update("picklo-hq-session").digest("hex");
}

const storage = createCookieSessionStorage({
  cookie: {
    name: "__picklo_hq",
    httpOnly: true,
    sameSite: "lax",
    path: "/hq",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_HOURS * 3600,
    secrets: [sessionSecret()],
  },
});

// ── Passwords (scrypt, per-user salt) ────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 12) return "Parola trebuie să aibă cel puțin 12 caractere.";
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Parola trebuie să conțină litere și cifre.";
  return null;
}

// ── Login ────────────────────────────────────────────────────────────────────
async function bootstrapAdmin(email, password) {
  const envEmail = process.env.HQ_ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.HQ_ADMIN_PASSWORD;
  if (!envEmail || !envPassword || email !== envEmail) return null;
  const a = Buffer.from(String(password)), b = Buffer.from(envPassword);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if ((await prisma.teamMember.count()) > 0) return null; // only for the very first account
  return prisma.teamMember.create({ data: { email, name: email.split("@")[0], passwordHash: hashPassword(password), role: "admin" } });
}

// → { member } or { error }
export async function login(emailRaw, password) {
  const email = String(emailRaw || "").trim().toLowerCase();
  let member = await prisma.teamMember.findUnique({ where: { email } });
  if (!member) member = await bootstrapAdmin(email, password);
  const generic = { error: "Email sau parolă greșite." };
  if (!member || !member.active) return generic;
  if (member.lockedUntil && member.lockedUntil > new Date()) {
    return { error: `Cont blocat temporar după prea multe încercări. Încearcă după ${member.lockedUntil.toLocaleTimeString("ro-RO", { timeZone: "Europe/Bucharest" })}.` };
  }
  if (!verifyPassword(password, member.passwordHash)) {
    const failed = member.failedLogins + 1;
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, ...(failed >= MAX_FAILED ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60e3) } : {}) },
    });
    return generic;
  }
  await prisma.teamMember.update({ where: { id: member.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return { member };
}

export async function createTeamSession(member, redirectTo = "/hq") {
  const session = await storage.getSession();
  session.set("memberId", member.id);
  return redirect(redirectTo, { headers: { "Set-Cookie": await storage.commitSession(session) } });
}

export async function logout(request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/hq/login", { headers: { "Set-Cookie": await storage.destroySession(session) } });
}

// Guard for every /hq loader and action. Redirects to the login page when needed.
export async function requireTeam(request, { role = null } = {}) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const id = session.get("memberId");
  const member = id ? await prisma.teamMember.findUnique({ where: { id } }) : null;
  if (!member || !member.active) {
    const url = new URL(request.url);
    throw redirect(`/hq/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (role === "admin" && member.role !== "admin") throw new Response("Doar administratorii au acces aici.", { status: 403 });
  return { id: member.id, email: member.email, name: member.name, role: member.role };
}

export const actorName = (member) => `suport:${member.email}`;
