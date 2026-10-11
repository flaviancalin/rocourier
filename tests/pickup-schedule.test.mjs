// Opening hours of pickup points, normalized per courier. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { fanSchedule, samedaySchedule, cargusSchedule, glsSchedule, packetaSchedule, dpdSchedule, isAlwaysOpen, openOn } from "../app/utils/pickup-schedule.js";

const ALL = "00:00-23:59";

test("FAN: 7 intervals, Monday first; lockers are 24/7", () => {
  const s = fanSchedule(Array(7).fill({ firstHour: "00:00", secondHour: "23:59" }));
  assert.deepEqual(s, Array(7).fill(ALL));
  assert.equal(isAlwaysOpen(s), true);
  assert.equal(fanSchedule([]), null);
});

test("Sameday: day 1..7, mall easybox with reduced hours", () => {
  const s = samedaySchedule([1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, openingHour: "10:00", closingHour: "22:00" })));
  assert.equal(s[6], "10:00-22:00");
  assert.equal(isAlwaysOpen(s), false);
  const noSunday = samedaySchedule([1, 2, 3, 4, 5, 6].map((day) => ({ day, openingHour: "09:00", closingHour: "18:00" })));
  assert.equal(openOn(noSunday, 6), false);
});

test("Cargus: empty Sunday means closed", () => {
  const p = { OpenHoursMoStart: "09:00", OpenHoursMoEnd: "19:00", OpenHoursTuStart: "09:00", OpenHoursTuEnd: "19:00", OpenHoursWeStart: "09:00", OpenHoursWeEnd: "19:00",
    OpenHoursThStart: "09:00", OpenHoursThEnd: "19:00", OpenHoursFrStart: "09:00", OpenHoursFrEnd: "19:00", OpenHoursSaStart: "09:00", OpenHoursSaEnd: "14:00", OpenHoursSuStart: "", OpenHoursSuEnd: "" };
  const s = cargusSchedule(p);
  assert.equal(s[5], "09:00-14:00");
  assert.equal(s[6], null);
  assert.equal(cargusSchedule({ Name: "x" }), null);
});

test("GLS: missing day closed, lunch break merged", () => {
  const s = glsSchedule([[1, "08:00", "12:00"], [1, "13:00", "17:00"], [6, "8:00", "13:00"]]);
  assert.equal(s[0], "08:00-17:00");
  assert.equal(s[5], "08:00-13:00");
  assert.equal(s[6], null);
});

test("Packeta: en dash ranges, split ranges, empty = closed", () => {
  const s = packetaSchedule({ regular: { monday: "09:00–17:00", tuesday: "08:00–12:00, 13:00–18:00", wednesday: "09:00–17:00", thursday: "09:00–17:00", friday: "09:00–17:00", saturday: "", sunday: "" } });
  assert.equal(s[0], "09:00-17:00");
  assert.equal(s[1], "08:00-18:00");
  assert.equal(openOn(s, 5), false);
  assert.equal(packetaSchedule(null), null);
});

test("DPD: dated schedule wins, Full/Half/DayOff as fallback", () => {
  const base = { workingTimeFrom: "09:00", workingTimeTo: "18:00", workingTimeHalfFrom: "09:00", workingTimeHalfTo: "13:00", workingTimeDayOffFrom: "00:00", workingTimeDayOffTo: "00:00" };
  const s = dpdSchedule(base);
  assert.deepEqual([s[0], s[5], s[6]], ["09:00-18:00", "09:00-13:00", null]);
  // 2026-10-18 is a Sunday: the APT locker is open that day
  const apt = dpdSchedule({ ...base, workingTimeSchedule: [{ date: "2026-10-18", workingTimeFrom: "00:00", workingTimeTo: "23:59", standardSchedule: true }] });
  assert.equal(apt[6], ALL);
});
