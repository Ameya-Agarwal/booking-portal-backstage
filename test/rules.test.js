import assert from "node:assert/strict";
import { practiceWindow, validateBatch, validateBooking, approvedClashes, signToken, verifyToken, safeEqual, emailAllowed, todayIST, addDays, CONFIG } from "../src/lib.js";

CONFIG.eventsEnabled = true; // event booking is switched off by default; the event rules are still tested
const today = "2026-10-17";
const fests = [
  { id: "f1", name: "Oasis", start: "2026-11-05", end: "2026-11-08" },
  { id: "f2", name: "Tech Fest", start: "2026-11-20", end: "2026-11-22", practiceStart: "2026-11-10", practiceEnd: "2026-11-18" },
  { id: "f3", name: "Cultural", start: "2026-11-25", end: "2026-11-27", practiceEnd: "2026-11-29" },
];
const base = { type: "event", club: "Mime Club", title: "N2O", date: "2026-10-21", startMin: 18 * 60, endMin: 21 * 60, items: { "dept-lights": 1 } };
const ctx = (bookings = []) => ({ today, fests, bookings });
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("event booking can be switched off", () => {
  CONFIG.eventsEnabled = false;
  assert.match(validateBooking(base, ctx()).error, /switched off/);
  assert.ok(validateBooking({ type: "practice", club: "Dance Club", festId: "f1", date: "2026-10-30", startMin: 960, endMin: 1080, items: { "equip-sounds": 1 } }, ctx()).row);
  CONFIG.eventsEnabled = true;
});
t("accepts a valid event 4 days out", () => assert.ok(validateBooking(base, ctx()).row));
t("rejects too little notice", () => assert.match(validateBooking({ ...base, date: "2026-10-19" }, ctx()).error, /at least 3 days/));
t("rejects more than 7 days ahead", () => assert.match(validateBooking({ ...base, date: "2026-10-25" }, ctx()).error, /up to 7 days/));
t("accepts exactly 7 days ahead", () => assert.ok(validateBooking({ ...base, date: "2026-10-24" }, ctx()).row));
t("rejects empty selection", () => assert.match(validateBooking({ ...base, items: {} }, ctx()).error, /at least one/));
t("rejects unknown resource", () => assert.match(validateBooking({ ...base, items: { nope: 1 } }, ctx()).error, /does not exist/));
t("rejects end before start", () => assert.match(validateBooking({ ...base, startMin: 1200, endMin: 1100 }, ctx()).error, /start and end/));
t("rejects event before 08:00", () => assert.match(validateBooking({ ...base, startMin: 6 * 60 }, ctx()).error, /run from/));
t("blocks overlapping pending booking", () => {
  const other = { id: "x", status: "pending", date: base.date, startMin: 20 * 60, endMin: 22 * 60, items: { "dept-lights": 1 } };
  assert.match(validateBooking(base, ctx([other])).error, /already booked/);
});
t("ignores cancelled and rejected bookings", () => {
  const other = { id: "x", status: "cancelled", date: base.date, startMin: 20 * 60, endMin: 22 * 60, items: { "dept-lights": 1 } };
  assert.ok(validateBooking(base, ctx([other])).row);
});
t("different resource at same time is fine", () => {
  const other = { id: "x", status: "approved", date: base.date, startMin: 18 * 60, endMin: 21 * 60, items: { "dept-sounds": 1 } };
  assert.ok(validateBooking(base, ctx([other])).row);
});
t("back-to-back bookings do not clash", () => {
  const other = { id: "x", status: "approved", date: base.date, startMin: 15 * 60, endMin: 18 * 60, items: { "dept-lights": 1 } };
  assert.ok(validateBooking(base, ctx([other])).row);
});

const pr = { type: "practice", club: "Dance Club", title: "", festId: "f1", date: "2026-10-30", startMin: 16 * 60, endMin: 18 * 60, items: { "equip-sounds": 1 } };
t("accepts practice inside the 14-day window", () => { const r = validateBooking(pr, ctx()); assert.ok(r.row); assert.equal(r.row.title, "Practice"); });
t("practice can be booked from tomorrow", () => {
  assert.ok(validateBooking({ ...pr, date: "2026-10-18" }, ctx()).row);
  assert.match(validateBooking({ ...pr, date: "2026-10-17" }, ctx()).error, /from 2026-10-18 to 2026-11-03/);
});
t("practice far ahead of the fest is allowed", () => assert.ok(validateBooking({ ...pr, date: "2026-10-20" }, ctx()).row));
t("practice closes 2 days before the fest", () => {
  assert.ok(validateBooking({ ...pr, date: "2026-11-03" }, ctx()).row);
  assert.match(validateBooking({ ...pr, date: "2026-11-04" }, ctx()).error, /can be booked from/);
});
t("rejects practice on or after fest start", () => assert.match(validateBooking({ ...pr, date: "2026-11-05" }, ctx()).error, /can be booked from/));
t("rejects practice longer than 2 hours", () => assert.match(validateBooking({ ...pr, endMin: 19 * 60 }, ctx()).error, /at most 2 hours/));
t("rejects practice outside 16:00-22:00", () => assert.match(validateBooking({ ...pr, startMin: 14 * 60, endMin: 16 * 60 }, ctx()).error, /Practice runs/));
t("rejects practice that is not whole hours", () => assert.match(validateBooking({ ...pr, startMin: 16 * 60 + 30, endMin: 18 * 60 + 30 }, ctx()).error, /whole hours/));
t("rejects practice for an unknown fest", () => assert.match(validateBooking({ ...pr, festId: "zzz" }, ctx()).error, /Choose a fest/));

const batch = { ...pr, slots: [
  { date: "2026-10-30", startMin: 960, endMin: 1080 },
  { date: "2026-11-02", startMin: 1020, endMin: 1140 },
] };
delete batch.date; delete batch.startMin; delete batch.endMin;
t("batch: several practice slots accepted as separate rows", () => { const r = validateBatch(batch, ctx()); assert.equal(r.rows.length, 2); assert.equal(r.rows[1].date, "2026-11-02"); });
t("batch: one bad slot rejects the whole request and names it", () => {
  const r = validateBatch({ ...batch, slots: [batch.slots[0], { date: "2026-11-05", startMin: 960, endMin: 1080 }] }, ctx());
  assert.match(r.error, /^Slot 2 \(2026-11-05/);
});
t("batch: two slots that overlap each other are rejected", () => {
  const r = validateBatch({ ...batch, slots: [batch.slots[0], { date: "2026-10-30", startMin: 1020, endMin: 1140 }] }, ctx());
  assert.match(r.error, /Slot 2.*already booked/);
});
t("batch: slot clashing with an existing booking is rejected", () => {
  const other = { id: "x", status: "approved", date: "2026-11-02", startMin: 1000, endMin: 1100, items: { "equip-sounds": 1 } };
  assert.match(validateBatch(batch, ctx([other])).error, /Slot 2.*already booked/);
});
t("batch: more than 10 slots rejected", () => {
  const many = Array.from({ length: 11 }, () => batch.slots[0]);
  assert.match(validateBatch({ ...batch, slots: many }, ctx()).error, /up to 10/);
});
t("batch: empty slots rejected, events cannot use slots", () => {
  assert.match(validateBatch({ ...batch, slots: [] }, ctx()).error, /at least one slot/);
  assert.match(validateBatch({ ...base, slots: [{ date: base.date, startMin: 1080, endMin: 1260 }] }, ctx()).error, /only for practice/);
});
t("batch: a plain single booking still works", () => assert.equal(validateBatch(base, ctx()).rows.length, 1));

const pr2 = { ...pr, festId: "f2" };
t("custom period: before it opens is rejected", () => assert.match(validateBooking({ ...pr2, date: "2026-11-09" }, ctx()).error, /from 2026-11-10 to 2026-11-18/));
t("custom period: first and last day accepted", () => {
  assert.ok(validateBooking({ ...pr2, date: "2026-11-10" }, ctx()).row);
  assert.ok(validateBooking({ ...pr2, date: "2026-11-18" }, ctx()).row);
});
t("custom period: after it closes is rejected, even before the fest", () => assert.match(validateBooking({ ...pr2, date: "2026-11-19" }, ctx()).error, /can be booked from/));
t("custom close date may be after the fest starts", () => assert.ok(validateBooking({ ...pr, festId: "f3", date: "2026-11-28" }, ctx()).row));
t("custom open date in the past falls back to tomorrow", () => {
  const w = practiceWindow({ start: "2026-11-05", practiceStart: "2026-10-01" }, today);
  assert.equal(w.lo, "2026-10-18"); assert.equal(w.hi, "2026-11-03");
});
t("window is closed when it ends before tomorrow", () => assert.equal(practiceWindow({ start: "2026-11-05", practiceEnd: "2026-10-17" }, today).closed, true));
t("default fest window is unchanged", () => assert.ok(validateBooking({ ...pr, date: "2026-11-03" }, ctx()).row));

t("approvedClashes flags only approved overlaps", () => {
  const b = { id: "b", date: base.date, startMin: 1080, endMin: 1260, items: { "dept-lights": 1, "dept-sounds": 1 } };
  const list = [
    { id: "a", status: "approved", date: base.date, startMin: 1100, endMin: 1200, items: { "dept-lights": 1 } },
    { id: "c", status: "pending", date: base.date, startMin: 1100, endMin: 1200, items: { "dept-sounds": 1 } },
  ];
  assert.deepEqual(approvedClashes(b, list), ["Department of Lights"]);
});

t("IST date rolls over at 18:30 UTC", () => {
  assert.equal(todayIST(Date.UTC(2026, 9, 17, 18, 29)), "2026-10-17");
  assert.equal(todayIST(Date.UTC(2026, 9, 17, 18, 31)), "2026-10-18");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
t("college email filter", () => {
  assert.ok(emailAllowed("f20251537@pilani.bits-pilani.ac.in", "bits-pilani.ac.in"));
  assert.ok(emailAllowed("club@bits-pilani.ac.in", "bits-pilani.ac.in"));
  assert.ok(!emailAllowed("x@gmail.com", "bits-pilani.ac.in"));
  assert.ok(!emailAllowed("x@evilbits-pilani.ac.in", "bits-pilani.ac.in"));
});

const secret = "test-secret";
const exp = Math.floor(Date.now() / 1000) + 60;
const tok = await signToken({ email: "a@b.c", name: "Ámeya ✓", exp }, secret);
const back = await verifyToken(tok, secret);
t("token round-trips with unicode", () => assert.equal(back.name, "Ámeya ✓"));
assert.equal(await verifyToken(tok, "other"), null);
assert.equal(await verifyToken(tok.slice(0, -2) + "xx", secret), null);
assert.equal(await verifyToken(await signToken({ email: "a", exp: 1 }, secret), secret), null);
console.log("ok - token tamper, wrong secret, expiry rejected");
assert.equal(await safeEqual("hunter2", "hunter2", secret), true);
assert.equal(await safeEqual("hunter2", "hunter3", secret), false);
console.log("ok - safeEqual");
console.log(`\n${n + 2} checks passed`);
