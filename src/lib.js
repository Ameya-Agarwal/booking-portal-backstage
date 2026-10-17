// Shared rules and helpers for the Main Audi Bookings Portal API.

export const CONFIG = {
  eventLeadDays: 3,        // events must be booked at least this many days ahead
  eventMaxDays: 7,         // events can be booked no more than this many days ahead
  practiceLeadDays: 1,     // practice must be booked at least this many days ahead
  practiceCloseDays: 2,    // last practice day is this many days before a fest starts
  practiceFromHour: 16,    // practice day opens
  practiceToHour: 22,      // practice day closes
  practiceMaxHours: 2,     // longest single practice booking
  dayFromHour: 8,          // earliest event start
  dayToHour: 24,           // latest event end
  maxSlotsPerRequest: 10,  // practice slots one request can hold
  eventsEnabled: false,    // set to true to bring back event booking (page tab and server)
};

export const RESOURCES = [
  { id: "dept-lights", name: "Department of Lights", group: "lights", kind: "department", qty: 1 },
  { id: "equip-lights", name: "Lights Equipment", group: "lights", kind: "equipment", qty: 1 },
  { id: "dept-sounds", name: "Department of Sounds", group: "sound", kind: "department", qty: 1 },
  { id: "equip-sounds", name: "Sounds Equipment", group: "sound", kind: "equipment", qty: 1 },
];

/* ---------- responses ---------- */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
export function fail(status, message) {
  return json({ error: message }, status);
}

/* ---------- dates (the college runs on India time) ---------- */
export function todayIST(now = Date.now()) {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const fmtMin = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

/* ---------- signed tokens (HMAC-SHA256) ---------- */
const enc = new TextEncoder();
const dec = new TextDecoder();
function toB64u(bytes) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64u(str) {
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signToken(payload, secret) {
  const body = toB64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + toB64u(new Uint8Array(sig));
}
export async function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64u(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64u(parts[0])));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
// Compare two strings without leaking where they differ.
export async function safeEqual(a, b, secret) {
  const key = await hmacKey(secret);
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(String(a))),
    crypto.subtle.sign("HMAC", key, enc.encode(String(b))),
  ]);
  const xa = new Uint8Array(x), ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

/* ---------- Google sign-in ---------- */
export function emailAllowed(email, domain) {
  if (!domain) return true;
  const e = String(email || "").toLowerCase(), d = String(domain).toLowerCase();
  return e.endsWith("@" + d) || e.endsWith("." + d);
}
export async function verifyGoogle(credential, env) {
  if (!credential || typeof credential !== "string") return { error: "Missing sign-in token." };
  let res;
  try {
    res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
  } catch {
    return { error: "Could not reach Google to check your sign-in. Try again in a moment.", status: 502 };
  }
  if (!res.ok) return { error: "Google did not accept that sign-in. Try again." };
  const j = await res.json();
  if (j.aud !== env.GOOGLE_CLIENT_ID) return { error: "This sign-in was issued for a different app." };
  if (String(j.email_verified) !== "true") return { error: "Your Google email is not verified." };
  if (Number(j.exp) < Date.now() / 1000) return { error: "That sign-in has expired. Try again." };
  if (!emailAllowed(j.email, env.ALLOWED_EMAIL_DOMAIN)) {
    return { error: "Use your college Google account (@" + env.ALLOWED_EMAIL_DOMAIN + ")." };
  }
  return { email: String(j.email).toLowerCase(), name: String(j.name || j.email).slice(0, 80) };
}

/* ---------- booking rules ---------- */
const blocking = (b) => b.status === "pending" || b.status === "approved";

// `ctx` = { today, fests: [{id,name,start,end}], bookings: [{id,date,startMin,endMin,items,status}] }
export function validateBooking(input, ctx) {
  const err = (error) => ({ error });
  if (!input || typeof input !== "object") return err("Invalid request.");
  const type = input.type;
  if (type !== "event" && type !== "practice") return err("Unknown booking type.");
  if (type === "event" && !CONFIG.eventsEnabled) return err("Event booking is switched off. Only practice slots can be booked.");

  const club = String(input.club || "").trim().slice(0, 80);
  if (!club) return err("Enter your club or department.");
  let title = String(input.title || "").trim().slice(0, 120);

  const date = input.date;
  if (!isDate(date)) return err("Pick a date.");
  const s = Number(input.startMin), e = Number(input.endMin);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || e <= s) return err("Check the start and end times.");

  const items = {};
  const given = input.items && typeof input.items === "object" ? input.items : {};
  for (const id of Object.keys(given)) {
    const r = RESOURCES.find((x) => x.id === id);
    if (!r) return err("One of the chosen items does not exist.");
    if (Number(given[id]) >= 1) items[id] = 1;
  }
  if (!Object.keys(items).length) return err("Choose at least one department or piece of equipment.");

  let festId = null;
  if (type === "event") {
    if (!title) return err("Enter the event name.");
    const min = addDays(ctx.today, CONFIG.eventLeadDays), max = addDays(ctx.today, CONFIG.eventMaxDays);
    if (date < min) return err(`Events need at least ${CONFIG.eventLeadDays} days notice. The earliest date is ${min}.`);
    if (date > max) return err(`Events can be booked up to ${CONFIG.eventMaxDays} days ahead. The latest date is ${max}.`);
    if (s < CONFIG.dayFromHour * 60 || e > CONFIG.dayToHour * 60) {
      return err(`Bookings run from ${fmtMin(CONFIG.dayFromHour * 60)} to ${fmtMin(CONFIG.dayToHour * 60)}.`);
    }
  } else {
    const fest = (ctx.fests || []).find((f) => f.id === input.festId);
    if (!fest) return err("Choose a fest.");
    festId = fest.id;
    const { lo: earliest, hi } = practiceWindow(fest, ctx.today);
    if (date < earliest || date > hi) {
      return err(`Practice for ${fest.name} can be booked from ${earliest} to ${hi}.`);
    }
    if (s % 60 || e % 60) return err("Practice slots are whole hours.");
    if (s < CONFIG.practiceFromHour * 60 || e > CONFIG.practiceToHour * 60) {
      return err(`Practice runs from ${fmtMin(CONFIG.practiceFromHour * 60)} to ${fmtMin(CONFIG.practiceToHour * 60)}.`);
    }
    if (e - s > CONFIG.practiceMaxHours * 60) return err(`Practice slots are at most ${CONFIG.practiceMaxHours} hours.`);
    if (!title) title = "Practice";
  }

  for (const id of Object.keys(items)) {
    const clash = (ctx.bookings || []).some(
      (b) => blocking(b) && b.date === date && b.startMin < e && b.endMin > s && b.items && b.items[id]
    );
    if (clash) {
      const r = RESOURCES.find((x) => x.id === id);
      return err(`${r.name} is already booked for that time.`);
    }
  }
  return { row: { type, club, title, date, startMin: s, endMin: e, items, festId } };
}

// The days clubs can book practice for a fest. Staff can set their own first and last day;
// without them it is tomorrow until `practiceCloseDays` before the fest starts.
export function practiceWindow(fest, today) {
  const tomorrow = addDays(today, CONFIG.practiceLeadDays);
  const lo = fest.practiceStart && fest.practiceStart > tomorrow ? fest.practiceStart : tomorrow;
  const hi = fest.practiceEnd || addDays(fest.start, -CONFIG.practiceCloseDays);
  return { lo, hi, closed: hi < lo };
}

// Validates a request that is either one booking, or a practice request with several `slots`.
// All slots must pass, otherwise nothing is accepted and the error names the slot.
export function validateBatch(input, ctx) {
  if (!input || typeof input !== "object") return { error: "Invalid request." };
  if (!Array.isArray(input.slots)) {
    const v = validateBooking(input, ctx);
    return v.error ? v : { rows: [v.row] };
  }
  if (input.type !== "practice") return { error: "Several slots at once are only for practice." };
  if (!input.slots.length) return { error: "Add at least one slot." };
  if (input.slots.length > CONFIG.maxSlotsPerRequest) {
    return { error: `You can request up to ${CONFIG.maxSlotsPerRequest} slots at once.` };
  }
  const rows = [], taken = [];
  for (let i = 0; i < input.slots.length; i++) {
    const sl = input.slots[i] || {};
    const v = validateBooking(
      { ...input, slots: undefined, date: sl.date, startMin: sl.startMin, endMin: sl.endMin },
      { ...ctx, bookings: [...(ctx.bookings || []), ...taken] }
    );
    if (v.error) return { error: `Slot ${i + 1} (${sl.date}, ${fmtMin(Number(sl.startMin) || 0)}-${fmtMin(Number(sl.endMin) || 0)}): ${v.error}` };
    rows.push(v.row);
    taken.push({ status: "pending", date: v.row.date, startMin: v.row.startMin, endMin: v.row.endMin, items: v.row.items });
  }
  return { rows };
}

// Items on `booking` that are already held by an approved booking at the same time.
export function approvedClashes(booking, bookings) {
  const out = [];
  for (const id of Object.keys(booking.items || {})) {
    const clash = bookings.some(
      (b) =>
        b.id !== booking.id && b.status === "approved" && b.date === booking.date &&
        b.startMin < booking.endMin && b.endMin > booking.startMin && b.items && b.items[id]
    );
    if (clash) out.push(RESOURCES.find((r) => r.id === id)?.name || id);
  }
  return out;
}
