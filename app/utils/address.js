// app/utils/address.js — Romanian address helpers shared by couriers and address validation.
// Pure functions (no I/O) so they can run anywhere and be unit-tested.

const DIACRITICS = { ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t", Ă: "A", Â: "A", Î: "I", Ș: "S", Ş: "S", Ț: "T", Ţ: "T" };

export const stripDiacritics = (s = "") => String(s).replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => DIACRITICS[c] || c);

// Lowercase, no diacritics, single spaces, no punctuation — for comparing place names.
export const normalizeName = (s = "") =>
  stripDiacritics(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Romanian phone → local 10-digit form ("07xxxxxxxx"), or null when it can't be a valid RO number.
export function normalizeRoPhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, "");
  if (d.startsWith("0040")) d = d.slice(4);
  else if (d.startsWith("40") && d.length === 11) d = d.slice(2);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d;
  return /^0\d{9}$/.test(d) ? d : null;
}

// Romanian postal codes are 6 digits; Bucharest starts with 0.
export const isValidRoZip = (zip) => /^\d{6}$/.test(String(zip || "").trim());

// Shopify sometimes gives "Bucharest" / "București" / "Sector 3" — collapse them to the county name couriers use.
export function normalizeRoCounty(county) {
  const n = normalizeName(county);
  if (!n) return "";
  if (n === "bucharest" || n.startsWith("bucuresti") || /^sector(ul)? ?\d$/.test(n)) return "Bucuresti";
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}

const STREET_TYPES = [
  ["bulevardul", "bd."], ["bulevard", "bd."], ["bdul", "bd."], ["blvd", "bd."], ["bd", "bd."],
  ["strada", "str."], ["str", "str."],
  ["soseaua", "sos."], ["sos", "sos."], ["calea", "cal."], ["cal", "cal."],
  ["aleea", "al."], ["al", "al."], ["piata", "pta."], ["pta", "pta."], ["intrarea", "intr."], ["intr", "intr."],
  ["splaiul", "spl."], ["spl", "spl."], ["drumul", "drum"], ["fundatura", "fnd."], ["prelungirea", "prel."],
];

// Splits a free-text Romanian street line into parts couriers understand:
//   "Str. Lalelelor nr. 5, bl. A2, sc. 1, ap. 12" →
//   { streetType: "str.", streetName: "Lalelelor", streetNo: "5", blockNo: "A2", entranceNo: "1", apartmentNo: "12" }
// Anything it can't place stays in `rest`, so the full text can still go to the courier as a note.
export function parseRoStreet(line = "") {
  let s = stripDiacritics(String(line)).replace(/\s+/g, " ").trim();
  const out = { streetType: null, streetName: null, streetNo: null, blockNo: null, entranceNo: null, floorNo: null, apartmentNo: null, rest: "" };
  if (!s) return out;

  const grab = (re, key) => {
    const m = s.match(re);
    if (m) { out[key] = m[1].replace(/[.,]$/, ""); s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim(); }
  };
  grab(/\b(?:bl(?:oc)?)\.?\s*([A-Za-z0-9-]+)/i, "blockNo");
  grab(/\b(?:sc(?:ara)?)\.?\s*([A-Za-z0-9-]+)/i, "entranceNo");
  grab(/\b(?:et(?:aj)?)\.?\s*([A-Za-z0-9-]+)/i, "floorNo");
  grab(/\b(?:ap(?:artament)?)\.?\s*([A-Za-z0-9-]+)/i, "apartmentNo");
  grab(/\b(?:nr|numar|no)\.?\s*([0-9]+[A-Za-z]?(?:-[0-9]+[A-Za-z]?)?)/i, "streetNo");

  s = s.replace(/^[,\s]+|[,\s]+$/g, "").replace(/\s*,\s*/g, ", ");
  const lower = s.toLowerCase();
  for (const [word, type] of STREET_TYPES) {
    const re = new RegExp(`^${word}\\.?\\s+`, "i");
    if (re.test(lower)) { out.streetType = type; s = s.replace(re, ""); break; }
  }
  // "Lalelelor 5" — a trailing number with no "nr." is the street number
  if (!out.streetNo) {
    const m = s.match(/^(.*?)[,\s]+([0-9]+[A-Za-z]?)$/);
    if (m && m[1]) { s = m[1]; out.streetNo = m[2]; }
  }
  const [name, ...rest] = s.split(",").map((p) => p.trim()).filter(Boolean);
  out.streetName = name || null;
  out.rest = rest.join(", ");
  return out;
}
