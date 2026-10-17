import assert from "node:assert/strict";
import { validateBooking, approvedClashes, signToken, verifyToken, safeEqual, emailAllowed, todayIST, addDays, CONFIG } from "../src/lib.js";

const today = "2026-10-17";
const fests = [{ id: "f1", name: "Oasis", start: "2026-11-05", end: "2026-11-08" }];
const base = { type: "event", club: "Mime Club", title: "N2O", date: "2026-10-21", startMin: 18 * 60, endMin: 21 * 60, items: { "dept-lights": 1 } };
const ctx = (bookings = []) => ({ today, fests, bookings });
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

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
t("rejects practice earlier than 14 days before", () => assert.match(validateBooking({ ...pr, date: "2026-10-20" }, ctx()).error, /runs from 2026-10-22 to 2026-11-04/));
t("rejects practice on or after fest start", () => assert.match(validateBooking({ ...pr, date: "2026-11-05" }, ctx()).error, /runs from/));
t("rejects practice longer than 2 hours", () => assert.match(validateBooking({ ...pr, endMin: 19 * 60 }, ctx()).error, /at most 2 hours/));
t("rejects practice outside 16:00-22:00", () => assert.match(validateBooking({ ...pr, startMin: 14 * 60, endMin: 16 * 60 }, ctx()).error, /Practice runs/));
t("rejects practice that is not whole hours", () => assert.match(validateBooking({ ...pr, startMin: 16 * 60 + 30, endMin: 18 * 60 + 30 }, ctx()).error, /whole hours/));
t("rejects practice for an unknown fest", () => assert.match(validateBooking({ ...pr, festId: "zzz" }, ctx()).error, /Choose a fest/));

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
