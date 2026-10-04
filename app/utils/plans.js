// app/utils/plans.js — shared by the billing UI and server billing code
export const PLANS = {
  monthly:  { name: "Pro Monthly",  price: 19.00,  interval: "EVERY_30_DAYS" },
  yearly:   { name: "Pro Yearly",   price: 149.00, interval: "ANNUAL" },
  lifetime: { name: "Pro Lifetime", price: 299.00, interval: null },
};
