// app/utils/pickup-schedule.js — opening hours of pickup points, one shape for every courier.
// A schedule is 7 entries, Monday first: "HH:MM-HH:MM" when open that day, null when closed.
// Unknown schedules stay null (we never claim a point is closed without data).

const HHMM = /^(\d{1,2}):(\d{2})$/;
const clean = (t) => {
  const m = String(t ?? "").trim().match(HHMM);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};
const range = (from, to) => {
  const a = clean(from), b = clean(to);
  if (!a || !b || (a === "00:00" && b === "00:00")) return null;
  return `${a}-${b}`;
};
const done = (days) => (days.some(Boolean) ? days : null);

// FAN: schedule[] of 7 { firstHour, secondHour }, Monday first
export function fanSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 7) return null;
  return done(schedule.map((d) => range(d?.firstHour, d?.secondHour)));
}

// Sameday: schedule[] of { day: 1..7 (Mon..Sun), openingHour, closingHour }; missing day = closed
export function samedaySchedule(schedule) {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  const days = Array(7).fill(null);
  for (const d of schedule) if (d?.day >= 1 && d.day <= 7) days[d.day - 1] = range(d.openingHour, d.closingHour);
  return done(days);
}

// Cargus: OpenHours{Mo,Tu,We,Th,Fr,Sa,Su}{Start,End}; empty = closed
export function cargusSchedule(p) {
  const keys = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  if (!p || !keys.some((k) => `OpenHours${k}Start` in p)) return null;
  return done(keys.map((k) => range(p[`OpenHours${k}Start`], p[`OpenHours${k}End`])));
}

// GLS: hours [[day 1..7, "HH:MM", "HH:MM"], …]; a day can appear twice (lunch break); missing day = closed
export function glsSchedule(hours) {
  if (!Array.isArray(hours) || !hours.length) return null;
  const days = Array(7).fill(null);
  for (const [day, from, to] of hours) {
    if (!(day >= 1 && day <= 7)) continue;
    const r = range(from, to);
    if (!r) continue;
    const prev = days[day - 1];
    days[day - 1] = prev ? `${prev.slice(0, 5)}-${r.slice(6)}` : r;
  }
  return done(days);
}

// Packeta: openingHours.regular.{monday..sunday} = "09:00–17:00" or "08:00–12:00, 13:00–17:00"; "" = closed
export function packetaSchedule(openingHours) {
  const reg = openingHours?.regular;
  if (!reg || typeof reg !== "object") return null;
  const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  if (!names.some((n) => n in reg)) return null;
  return done(names.map((n) => {
    const times = String(reg[n] || "").match(/\d{1,2}:\d{2}/g);
    return times?.length >= 2 ? range(times[0], times[times.length - 1]) : null;
  }));
}

// DPD (Speedy platform): workingTimeSchedule[] for the next days, else Full (Mon–Fri) / Half (Sat) / DayOff (Sun)
export function dpdSchedule(o) {
  if (!o) return null;
  const days = Array(7).fill(undefined);
  for (const d of o.workingTimeSchedule || []) {
    const date = new Date(`${d.date}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const idx = (date.getUTCDay() + 6) % 7;
    if (days[idx] === undefined || d.standardSchedule) days[idx] = range(d.workingTimeFrom, d.workingTimeTo);
  }
  const full = range(o.workingTimeFrom, o.workingTimeTo);
  const half = range(o.workingTimeHalfFrom, o.workingTimeHalfTo);
  const off = range(o.workingTimeDayOffFrom, o.workingTimeDayOffTo);
  const fallback = [full, full, full, full, full, half, off];
  return done(days.map((d, i) => (d === undefined ? fallback[i] : d)));
}

export const isAlwaysOpen = (s) => Array.isArray(s) && s.every((d) => d === "00:00-23:59" || d === "00:00-24:00");
export const openOn = (s, dayIndex) => (Array.isArray(s) ? !!s[dayIndex] : null); // 5 = Saturday, 6 = Sunday
