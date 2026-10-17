// One catch-all handler for every /api/* route.
import {
  CONFIG, RESOURCES, json, fail, todayIST, addDays, isDate,
  signToken, verifyToken, safeEqual, verifyGoogle, validateBooking, approvedClashes,
} from "../../src/lib.js";

const SESSION_SECONDS = 60 * 60 * 24 * 14; // sign-in lasts 14 days
const STAFF_SECONDS = 60 * 60 * 12;        // staff access lasts 12 hours

const mapBooking = (r) => ({
  id: r.id, type: r.type, club: r.club, title: r.title, date: r.date,
  startMin: r.start_min, endMin: r.end_min, items: JSON.parse(r.items || "{}"),
  festId: r.fest_id || null, status: r.status, note: r.note || "",
  createdBy: r.created_by, createdByName: r.created_by_name,
});

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function currentUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const p = await verifyToken(token, env.SESSION_SECRET);
  if (!p || !p.email) return null;
  const staffPayload = await verifyToken(request.headers.get("x-staff-token") || "", env.SESSION_SECRET);
  const staff = !!(staffPayload && staffPayload.role === "staff" && staffPayload.email === p.email);
  return { email: p.email, name: p.name || p.email, staff };
}

async function loadBookings(env, today) {
  const since = addDays(today, -60);
  const { results } = await env.DB.prepare("SELECT * FROM bookings WHERE date >= ? ORDER BY date, start_min LIMIT 3000").bind(since).all();
  return results.map(mapBooking);
}
async function loadFests(env) {
  const { results } = await env.DB.prepare("SELECT id, name, start, end FROM fests ORDER BY start").all();
  return results;
}

export async function onRequest({ request, env, params }) {
  if (!env.SESSION_SECRET) return fail(500, "The server is missing SESSION_SECRET.");
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method;
  const route = parts[0];
  const today = todayIST();

  try {
    /* ----- public ----- */
    if (route === "config" && method === "GET") {
      return json({ config: CONFIG, resources: RESOURCES, googleClientId: env.GOOGLE_CLIENT_ID || "", domain: env.ALLOWED_EMAIL_DOMAIN || "" });
    }
    if (route === "login" && method === "POST") {
      const body = await readBody(request);
      const g = await verifyGoogle(body && body.credential, env);
      if (g.error) return fail(g.status || 401, g.error);
      const session = await signToken({ email: g.email, name: g.name, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, env.SESSION_SECRET);
      return json({ session, user: { email: g.email, name: g.name, staff: false } });
    }

    /* ----- everything below needs a signed-in college account ----- */
    const user = await currentUser(request, env);
    if (!user) return fail(401, "Sign in to continue.");

    if (route === "staff-login" && method === "POST") {
      if (!env.STAFF_PASSWORD) return fail(500, "The server is missing STAFF_PASSWORD.");
      const body = await readBody(request);
      const ok = await safeEqual((body && body.password) || "", env.STAFF_PASSWORD, env.SESSION_SECRET);
      if (!ok) return fail(403, "That staff password is not right.");
      const token = await signToken({ role: "staff", email: user.email, exp: Math.floor(Date.now() / 1000) + STAFF_SECONDS }, env.SESSION_SECRET);
      return json({ token });
    }

    if (route === "state" && method === "GET") {
      const [bookings, fests] = await Promise.all([loadBookings(env, today), loadFests(env)]);
      return json({ me: user, today, fests, bookings });
    }

    if (route === "bookings" && method === "POST" && parts.length === 1) {
      const body = await readBody(request);
      const [bookings, fests] = await Promise.all([loadBookings(env, today), loadFests(env)]);
      const v = validateBooking(body, { today, fests, bookings });
      if (v.error) return fail(400, v.error);
      const r = v.row;
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      await env.DB.prepare(
        "INSERT INTO bookings (id,type,club,title,date,start_min,end_min,items,fest_id,status,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)"
      ).bind(id, r.type, r.club, r.title, r.date, r.startMin, r.endMin, JSON.stringify(r.items), r.festId, user.email, user.name, new Date().toISOString()).run();
      return json({ id }, 201);
    }

    if (route === "bookings" && parts.length === 3 && method === "POST") {
      const id = parts[1], action = parts[2];
      const row = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
      if (!row) return fail(404, "That booking does not exist.");
      const b = mapBooking(row);

      if (action === "cancel") {
        if (b.createdBy !== user.email && !user.staff) return fail(403, "Only the club that booked can cancel this.");
        if (b.status !== "pending" && b.status !== "approved") return fail(400, "This booking is already closed.");
        await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (action === "decide") {
        if (!user.staff) return fail(403, "Staff sign-in is needed to review requests.");
        const body = await readBody(request);
        const status = body && body.status;
        if (status !== "approved" && status !== "rejected") return fail(400, "Choose approve or decline.");
        if (b.status !== "pending") return fail(400, "This request was already reviewed.");
        if (status === "approved") {
          const all = await loadBookings(env, today);
          const clash = approvedClashes(b, all);
          if (clash.length) return fail(409, "Already held by an approved booking: " + clash.join(", ") + ".");
        }
        const note = String((body && body.note) || "").trim().slice(0, 200);
        await env.DB.prepare("UPDATE bookings SET status=?, note=?, decided_by=?, decided_at=? WHERE id=?")
          .bind(status, note, user.email, new Date().toISOString(), id).run();
        return json({ ok: true });
      }
    }

    if (route === "fests") {
      if (!user.staff) return fail(403, "Staff sign-in is needed to manage fests.");
      if (method === "POST" && parts.length === 1) {
        const body = await readBody(request);
        const name = String((body && body.name) || "").trim().slice(0, 80);
        if (!name || !isDate(body && body.start) || !isDate(body && body.end)) return fail(400, "Enter the fest name and both dates.");
        if (body.end < body.start) return fail(400, "The last day cannot be before the first day.");
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
        await env.DB.prepare("INSERT INTO fests (id,name,start,end) VALUES (?,?,?,?)").bind(id, name, body.start, body.end).run();
        return json({ id }, 201);
      }
      if (method === "DELETE" && parts.length === 2) {
        await env.DB.prepare("DELETE FROM fests WHERE id = ?").bind(parts[1]).run();
        return json({ ok: true });
      }
    }

    return fail(404, "Not found.");
  } catch (err) {
    console.error(err);
    return fail(500, "Something went wrong on the server. Try again in a moment.");
  }
}
