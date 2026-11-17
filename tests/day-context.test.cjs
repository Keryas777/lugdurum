const test = require("node:test");
const assert = require("node:assert/strict");
const Days = require("../docs/lugdurum-day-context.js");

const day = (id, date, users, extra = {}) => ({
  journee_id: id, mission_id: "EVT_" + id, date, jour_label: "J1",
  statut: "prevu", vendeurs_autorises: JSON.stringify(users.map((user_id) => ({ user_id }))),
  ...extra
});
const days = [
  day("CHARLY", "2026-11-28", ["U_ANTHONY"]),
  day("COLOMBIER_J1", "2026-11-28", ["U_WILL"]),
  day("COMMUNAY", "2026-11-28", ["U_JEROME"]),
  day("COLOMBIER_J2", "2026-11-29", ["U_WILL"]),
  day("TOUR_J1", "2026-12-05", ["U_ANTHONY", "U_WILL"]),
  day("GENAS_J1", "2026-12-05", ["U_JEROME"]),
  day("TOUR_J2", "2026-12-06", ["U_ANTHONY"]),
  day("VERNAISON", "2026-12-06", ["U_WILL"]),
  day("CREMIEU", "2026-12-08", ["U_ANTHONY", "U_WILL"], { stock_mission_id: "MST_ANTHONY" }),
  day("CHAPONOST", "2026-12-08", ["U_JEROME"]),
];

test("William is assigned to Colombier J1 on 28 November and J2 on 29 November", () => {
  assert.equal(Days.scheduleFor(days, "U_WILL", "2026-11-28").days[0].journee_id, "COLOMBIER_J1");
  assert.equal(Days.scheduleFor(days, "U_WILL", "2026-11-29").days[0].journee_id, "COLOMBIER_J2");
});
test("shared Tour and Crémieu days authorize Anthony and William", () => {
  assert.equal(Days.isAuthorized(days.find((d) => d.journee_id === "TOUR_J1"), "U_ANTHONY"), true);
  assert.equal(Days.isAuthorized(days.find((d) => d.journee_id === "TOUR_J1"), "U_WILL"), true);
  const cremieu = days.find((d) => d.journee_id === "CREMIEU");
  assert.deepEqual(Days.canSell(cremieu, "U_WILL", { mission_id: "MST_ANTHONY", statut: "en_cours" }, "2026-12-08"), { allowed: true, reason: "" });
});
test("William on 6 December is assigned to Vernaison, not Tour J2", () => {
  assert.equal(Days.scheduleFor(days, "U_WILL", "2026-12-06").days[0].journee_id, "VERNAISON");
  assert.equal(Days.isAuthorized(days.find((d) => d.journee_id === "TOUR_J2"), "U_WILL"), false);
});
test("Jerome on 8 December is assigned to Chaponost", () => {
  assert.equal(Days.scheduleFor(days, "U_JEROME", "2026-12-08").days[0].journee_id, "CHAPONOST");
});
test("today takes priority, then next future day; same-day matches require an explicit choice", () => {
  assert.equal(Days.scheduleFor(days, "U_WILL", "2026-12-04").days[0].journee_id, "TOUR_J1");
  const result = Days.scheduleFor([
    ...days, day("SECOND", "2026-12-05", ["U_WILL"])
  ], "U_WILL", "2026-12-05");
  assert.equal(result.mode, "choose_today");
  assert.equal(result.days.length, 2);
});
test("unauthorized consultation and legacy days without authorization are read-only", () => {
  assert.equal(Days.canSell(days.find((d) => d.journee_id === "VERNAISON"), "U_ANTHONY", { mission_id: "MST", statut: "en_cours" }).reason, "unauthorized");
  assert.equal(Days.isAuthorized({ journee_id: "OLD", date: "2025-01-01" }, "U_JEROME"), false);
});
test("no stock association never creates an implied stock mission", () => {
  assert.equal(Days.canSell(days.find((d) => d.journee_id === "TOUR_J1"), "U_WILL", null, "2026-12-05").reason, "stock_missing");
});
test("Paris date is stable across UTC day boundaries", () => {
  assert.equal(Days.parisDateIso(new Date("2026-11-27T23:30:00.000Z")), "2026-11-28");
});

test("future day is not writable before its France-local date", () => {
  const cremieu = days.find((d) => d.journee_id === "CREMIEU");
  assert.equal(Days.canSell(cremieu, "U_WILL", { mission_id: "MST_ANTHONY", statut: "en_cours" }, "2026-12-07").reason, "not_today");
});
test("status change to closed blocks a sale without changing its recorded context", () => {
  const closed = { ...days.find((d) => d.journee_id === "CREMIEU"), statut: "cloture" };
  assert.equal(Days.canSell(closed, "U_WILL", { mission_id: "MST_ANTHONY", statut: "en_cours" }, "2026-12-08").reason, "closed");
});

test("Anthony receives La Tour J1 on 5 December and J2 on 6 December", () => {
  assert.equal(Days.scheduleFor(days, "U_ANTHONY", "2026-12-05").days[0].journee_id, "TOUR_J1");
  assert.equal(Days.scheduleFor(days, "U_ANTHONY", "2026-12-06").days[0].journee_id, "TOUR_J2");
});
test("both sellers are assigned to the same shared 5 December day", () => {
  const day = days.find((item) => item.journee_id === "TOUR_J1");
  assert.equal(Days.isAuthorized(day, "U_ANTHONY"), true);
  assert.equal(Days.isAuthorized(day, "U_WILL"), true);
});
