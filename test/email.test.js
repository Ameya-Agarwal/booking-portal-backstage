import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/[[path]].js";
import { signToken, todayIST, addDays } from "../src/lib.js";
import { bookingEmail, bookingTeamRecipients } from "../src/email.js";
import recipients from "../config/notification-recipients.json" with { type: "json" };

test("the configured recipient lists are valid", () => {
  assert.doesNotThrow(() => bookingTeamRecipients([
    { items: { "dept-lights": 1, "dept-sounds": 1 } },
  ], "requester@example.com"));
});

test("submission and decision notifications follow committed changes and use the requester", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const savedRecipients = structuredClone(recipients);
  Object.assign(recipients, { backstage: ["backstage@example.com"], lights: ["lights@example.com"], sounds: ["sounds@example.com"] });
  const rows = [];
  const sent = [];
  let failMail = false, failWrite = false, race = false;
  const env = {
    SESSION_SECRET: "test-secret", RESEND_API_KEY: "test-key", BOOKING_EMAIL_FROM: "Desk <desk@example.com>",
    DB: {
      prepare(sql) {
        let values;
        return {
          bind(...args) { values = args; return this; },
          async all() { return { results: sql.includes("FROM fests") ? [{ id: "fest", start: addDays(todayIST(), 10) }] : rows }; },
          async first() { return rows.find((r) => r.id === values[0]); },
          async run() {
            if (failWrite) throw new Error("write failed");
            if (race) return { meta: { changes: 0 } };
            const row = rows.find((r) => r.id === values[4]);
            row.status = values[0]; row.note = values[1];
            return { meta: { changes: 1 } };
          },
          insert() {
            const [id, type, club, title, date, start_min, end_min, items, fest_id, created_by, created_by_name] = values;
            rows.push({ id, type, club, title, date, start_min, end_min, items, fest_id, created_by, created_by_name, status: "pending" });
          },
        };
      },
      async batch(statements) {
        if (failWrite) throw new Error("write failed");
        statements.forEach((s) => s.insert());
      },
    },
  };
  async function request(path, body, staff = false) {
    const email = staff ? "staff@example.com" : "requester@example.com";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const headers = { authorization: `Bearer ${await signToken({ email, exp }, env.SESSION_SECRET)}` };
    if (staff) headers["x-staff-token"] = await signToken({ email, role: "staff", exp }, env.SESSION_SECRET);
    return onRequest({ env, params: { path: path.split("/") }, request: new Request(`https://portal.test/api/${path}`, { method: "POST", headers, body: JSON.stringify(body) }) });
  }
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers.authorization, "Bearer test-key");
    assert.ok(rows.length, "email follows successful insert");
    const payload = JSON.parse(options.body);
    sent.push(payload);
    return new Response("{}", { status: failMail ? 503 : 200 });
  };
  console.error = () => {};
  try {
    const input = { type: "practice", club: "Dance & Drama", festId: "fest", items: { "dept-lights": 1 }, slots: [
      { date: addDays(todayIST(), 1), startMin: 960, endMin: 1080 },
      { date: addDays(todayIST(), 2), startMin: 1080, endMin: 1200 },
    ] };
    const created = await request("bookings", input);
    assert.equal(created.status, 201);
    const { ids } = await created.json();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["requester@example.com"]);
    assert.deepEqual(sent[0].bcc, ["backstage@example.com", "lights@example.com"]);
    assert.match(sent[0].text, /Resources: Department of Lights/);
    for (const id of ids) assert.ok(sent[0].text.includes(id));
    assert.match(sent[0].text, /Club \/ department: Dance & Drama/);
    assert.match(sent[0].text, /16:00–18:00 IST/);
    assert.match(sent[0].text, /Status: Pending/);
    for (const status of ["approved", "rejected", "approved"]) {
      const res = await request(`bookings/${ids[0]}/decide`, { status, note: "Desk note" }, true);
      assert.equal(res.status, 200);
      assert.deepEqual(sent.at(-1).to, ["requester@example.com"]);
      assert.deepEqual(sent.at(-1).bcc, ["backstage@example.com", "lights@example.com"]);
      assert.match(sent.at(-1).text, new RegExp(`Status: ${status === "approved" ? "Approved" : "Denied"}`));
      assert.match(sent.at(-1).text, /Staff note: Desk note/);
      assert.equal(rows[0].status, status);
    }
    const count = sent.length;
    assert.equal((await request(`bookings/${ids[0]}/decide`, { status: "approved" }, true)).status, 400);
    assert.equal((await request(`bookings/${ids[0]}/decide`, { status: "rejected" })).status, 403);
    race = true;
    assert.equal((await request(`bookings/${ids[0]}/decide`, { status: "rejected" }, true)).status, 409);
    race = false;
    failWrite = true;
    assert.equal((await request(`bookings/${ids[0]}/decide`, { status: "rejected" }, true)).status, 500);
    assert.equal(sent.length, count);
    failWrite = false;
    failMail = true;
    const failedEmail = await request(`bookings/${ids[0]}/decide`, { status: "rejected" }, true);
    assert.equal(failedEmail.status, 200);
    assert.match((await failedEmail.json()).warning, /booking was saved/);
    assert.equal(rows[0].status, "rejected");
    delete env.RESEND_API_KEY;
    const missingConfig = await request(`bookings/${ids[0]}/decide`, { status: "approved" }, true);
    assert.equal(missingConfig.status, 200);
    assert.ok((await missingConfig.json()).warning);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Object.assign(recipients, savedRecipients);
  }
});

test("team routing handles departments, equipment, multiple slots, and duplicate addresses", () => {
  const config = { backstage: ["desk@example.com"], lights: ["lights@example.com"], sounds: ["sounds@example.com"] };
  const route = (items) => bookingTeamRecipients([{ items }], "requester@example.com", config);
  for (const id of ["dept-lights", "equip-lights"]) {
    assert.deepEqual(route({ [id]: 1 }), ["desk@example.com", "lights@example.com"]);
  }
  for (const id of ["dept-sounds", "equip-sounds"]) {
    assert.deepEqual(route({ [id]: 1 }), ["desk@example.com", "sounds@example.com"]);
  }
  assert.deepEqual(route({ "equip-lights": 0, "equip-sounds": 1 }), ["desk@example.com", "sounds@example.com"]);
  assert.deepEqual(bookingTeamRecipients([
    { items: { "dept-lights": 1 } }, { items: { "equip-sounds": 1 } },
  ], "requester@example.com", config), ["desk@example.com", "lights@example.com", "sounds@example.com"]);
  assert.deepEqual(bookingTeamRecipients([{ items: { "dept-lights": 1 } }], "requester@example.com", {
    backstage: [" DESK@example.com ", "requester@example.com"], lights: ["desk@example.com"], sounds: [],
  }), ["desk@example.com"]);
  assert.deepEqual(bookingTeamRecipients([{ items: {} }], "requester@example.com", { backstage: [], lights: [], sounds: [] }), []);
  assert.throws(() => bookingTeamRecipients([{ items: {} }], "requester@example.com", { backstage: ["bad address"] }), /Invalid email/);
});

test("email preserves the booking date and midnight end time", () => {
  const mail = bookingEmail([{ id: "b1", club: "Club", title: "Event", date: "2026-10-21", startMin: 1380, endMin: 1440, status: "approved" }]);
  assert.match(mail.text, /Date: 2026-10-21/);
  assert.match(mail.text, /23:00–24:00 IST/);
});
