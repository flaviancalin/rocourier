// Keep in sync with app/services/cod-guard.server.js — the blocklist stores these hashes,
// never the customers' emails or phone numbers.
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export const contactHash = (s) => fnv1a(s, 2166136261) + fnv1a(s, 0x9e3779b9);
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-9);
