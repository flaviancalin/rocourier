// app/services/courier-choice.server.js — which courier ships an order when nobody picks one by hand
// (automatic AWB, bulk generation, the wizard's suggestion). Order of precedence:
//   1. a locker / pickup point the customer chose belongs to one courier: keep it
//   2. the merchant's courier rules (Settings → Livrare & verificări)
//   3. automatic choice: the cheapest connected courier, from the couriers' price APIs, or from
//      the price the merchant entered for couriers without one (GLS, Packeta…)
import { courierFromRules } from "./order-checks.server.js";
import { compareRates } from "./rates-compare.server.js";
import { COURIER_LABELS } from "../utils/couriers.js";

const nameOf = (c) => COURIER_LABELS[c]?.name || c;

// Merchant-entered prices fill in couriers whose API gave no price
export function withFixedPrices(rates, settings) {
  const fixed = settings?.autoCourierPrices && typeof settings.autoCourierPrices === "object" ? settings.autoCourierPrices : {};
  return rates
    .map((r) => {
      const f = Number.parseFloat(fixed[r.courier]);
      return r.price == null && Number.isFinite(f) && f > 0 ? { ...r, price: f, source: "fixed" } : { ...r, source: r.price != null ? "api" : null };
    })
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

// → { courier, reason, rates? } — courier null means "keep the order's courier"
export async function chooseCourier(settings, order, { rates: given = null } = {}) {
  if (order.shippingMethod === "pickup_point" && order.pickupPointId) {
    return { courier: order.courierType || null, reason: "lockerul ales de client" };
  }
  const ruled = courierFromRules(settings, order);
  if (ruled) return { courier: ruled, reason: "regulă de curier" };
  if (settings?.autoCourierMode !== "cheapest") return { courier: null, reason: null };

  const rates = withFixedPrices(given || await compareRates(settings, order), settings).filter((r) => settings[`${r.courier}Enabled`]);
  const best = rates.find((r) => r.price != null);
  if (!best) return { courier: null, reason: "niciun tarif disponibil", rates };
  const next = rates.find((r) => r.price != null && r.courier !== best.courier);
  const diff = next ? ` (${nameOf(next.courier)} ${next.price.toFixed(2)} RON)` : "";
  return { courier: best.courier, reason: `cel mai ieftin: ${nameOf(best.courier)} ${best.price.toFixed(2)} RON${diff}`, rates };
}
