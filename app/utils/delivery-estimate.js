// app/utils/delivery-estimate.js — when will the parcel arrive?
// Working days skip weekends and Romanian public holidays. Orders placed after the
// merchant's dispatch cut-off (Romania time) leave on the next working day.
// The cart widget has a copy of this logic (extensions/rocourier-cart/assets/rocourier.js).

// Orthodox Easter (Julian computus + 13 days to Gregorian, valid 1900–2099)
export function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day + 13));
}

const ymd = (d) => d.toISOString().slice(0, 10);

export function romanianHolidays(year) {
  const fixed = ["01-01", "01-02", "01-06", "01-07", "01-24", "05-01", "06-01", "08-15", "11-30", "12-01", "12-25", "12-26"]
    .map((md) => `${year}-${md}`);
  const easter = orthodoxEaster(year);
  const plus = (n) => ymd(new Date(easter.getTime() + n * 86400000));
  return new Set([...fixed, plus(-2), plus(0), plus(1), plus(49), plus(50)]);
}

export function isWorkingDay(date) {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !romanianHolidays(date.getUTCFullYear()).has(ymd(date));
}

export function addWorkingDays(date, n) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

// Current date/hour in Romania regardless of the server's timezone.
export function romaniaNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day)), hour: +parts.hour, minute: +parts.minute };
}

// { shipDate, minDate, maxDate } as UTC dates (date part only).
export function estimateDelivery({ now = new Date(), cutoffHour = 14, processingDays = 0, transitMin = 1, transitMax = 2 } = {}) {
  const { date, hour } = romaniaNow(now);
  let ship = date;
  if (!isWorkingDay(ship) || hour >= cutoffHour) ship = addWorkingDays(ship, 1);
  if (processingDays > 0) ship = addWorkingDays(ship, processingDays);
  return { shipDate: ship, minDate: addWorkingDays(ship, transitMin), maxDate: addWorkingDays(ship, transitMax) };
}
