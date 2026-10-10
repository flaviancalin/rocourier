// app/services/anaf.server.js
// Company data from ANAF's public VAT register (no key needed):
// POST https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva  [{ cui, data }]
// Used to fill B2B invoices with the official name, registry number and address.
const ANAF_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";
const cache = new Map(); // cui → { at, value }
const TTL = 24 * 3600 * 1000;

export const cleanCui = (v) => String(v || "").toUpperCase().replace(/^RO/, "").replace(/\D/g, "");

export async function lookupCompany(vatCode) {
  const cui = cleanCui(vatCode);
  if (!/^\d{2,10}$/.test(cui)) return null;
  const hit = cache.get(cui);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(ANAF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ cui: Number(cui), data: today }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ANAF [${res.status}]`);
  const data = await res.json();
  const f = data.found?.[0];
  const value = f ? {
    cui,
    name: f.date_generale?.denumire || null,
    regCom: f.date_generale?.nrRegCom || null,
    address: f.date_generale?.adresa || null,
    vatPayer: !!f.inregistrare_scop_Tva?.scpTVA,
    vatCode: f.inregistrare_scop_Tva?.scpTVA ? `RO${cui}` : cui,
    county: f.adresa_sediu_social?.sdenumire_Judet || null,
    city: f.adresa_sediu_social?.sdenumire_Localitate || null,
    inactive: !!f.stare_inactiv?.statusInactivi,
  } : null;
  cache.set(cui, { at: Date.now(), value });
  return value;
}

// Fills company fields of a normalized invoice order from ANAF. Never throws:
// invoicing must not fail because ANAF is slow.
export async function enrichCompany(order) {
  if (!order?.customerVatCode) return order;
  try {
    const c = await lookupCompany(order.customerVatCode);
    if (!c) return order;
    return {
      ...order,
      customerCompany: c.name || order.customerCompany,
      customerVatCode: c.vatCode,
      customerRegCom: order.customerRegCom || c.regCom || undefined,
      companyAddress: c.address,
    };
  } catch (e) {
    console.error("[ANAF] lookup failed:", e.message);
    return order;
  }
}
