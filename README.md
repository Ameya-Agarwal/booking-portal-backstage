# Main Audi Bookings Portal

A booking portal for the BITS Pilani main auditorium. Clubs sign in with their college Google account and book the **Department of Lights**, **Lights Equipment**, **Department of Sounds** and **Sounds Equipment** for **practice slots** before a fest. The stage controls departments ("staff") review each request on a Desk page, approve or decline it, and the club gets an email with the decision.

Live site: https://booking-portal-backstage.pages.dev

This README is written for two readers: someone **using or deploying** the portal (sections 1, 2, 11, 12) and you, later, **coming back to learn web development from it** (sections 3 to 10). Every file is small enough to read in one sitting.

---

## Contents

1. [What it does](#1-what-it-does)
2. [The rules the portal enforces](#2-the-rules-the-portal-enforces)
3. [How the pieces fit together](#3-how-the-pieces-fit-together)
4. [Web dev concepts used here](#4-web-dev-concepts-used-here)
5. [Folder map](#5-folder-map)
6. [Walkthrough of every file](#6-walkthrough-of-every-file)
7. [Following one request end to end](#7-following-one-request-end-to-end)
8. [Database](#8-database)
9. [API reference](#9-api-reference)
10. [Tests](#10-tests)
11. [Setup and deployment](#11-setup-and-deployment)
12. [Operating the portal](#12-operating-the-portal)
13. [Troubleshooting](#13-troubleshooting)
14. [Free-tier limits](#14-free-tier-limits)
15. [Ideas for learning by extending it](#15-ideas-for-learning-by-extending-it)

---

## 1. What it does

**For clubs** (anyone signed in with a college Google account):

| Tab | What you do there |
|---|---|
| **Practice slots** | Pick a fest, pick a day, tap hours to make a 2-hour slot, add it to the request, repeat for up to 10 slots, tick the departments and equipment you need, and send. |
| **Schedule** | A timeline of one day showing every pending and approved booking, so you can see what is taken. Step through days with Prev and Next. |
| **My bookings** | Your own requests with their status (Awaiting approval, Approved, Declined, Cancelled). You can cancel a pending or approved one. |

**For staff** (after entering the shared staff password under "Staff sign-in"): a fourth tab, **Desk**.

| Desk page | What you do there |
|---|---|
| **Approvals** | Three lists. *Waiting for approval* (Approve or Decline, with an optional note). *Approved, upcoming* (**Withdraw approval**). *Declined or withdrawn, upcoming* (**Approve again**). |
| **Fests** | Add or remove fests, and set a custom practice **Opens / Closes** period for each one. |

Every approve, decline or withdraw sends the club an email (see [Decision emails](#decision-emails)).

Event booking (a separate "Book an event" page with 3 to 7 days notice) was built and then switched off. The code is still there behind `CONFIG.eventsEnabled` in `src/lib.js`.

---

## 2. The rules the portal enforces

These all live in one place, `CONFIG` in `src/lib.js`. The server enforces them. The browser repeats some of them only to give instant feedback.

| Rule | Value | Where |
|---|---|---|
| Practice can be booked from | the day after the request is made | `practiceLeadDays: 1` |
| Practice can be booked until | 2 days before the fest starts | `practiceCloseDays: 2` |
| Custom period per fest | staff can set their own first and last day (first day can't be earlier than tomorrow) | `fests.practice_start / practice_end` |
| Practice hours | 16:00 to 22:00, whole hours only | `practiceFromHour`, `practiceToHour` |
| Longest practice slot | 2 hours | `practiceMaxHours` |
| Slots per request | up to 10, and all-or-nothing | `maxSlotsPerRequest` |
| Resources | 4 fixed items, 1 of each; a pending or approved booking holds the item | `RESOURCES` |
| Two bookings can't overlap on the same item | checked at request time (against pending and approved) and again at approval time (against approved) | `validateBooking`, `approvedClashes` |
| Who can sign in | emails ending in `@bits-pilani.ac.in` or `.bits-pilani.ac.in` | `ALLOWED_EMAIL_DOMAIN` in `wrangler.toml` |
| Dates and "today" | India time (IST), not the server's time zone | `todayIST` |
| Events (switched off) | 3 to 7 days ahead, 08:00 to 24:00 | `eventLeadDays`, `eventMaxDays`, `eventsEnabled` |

---

## 3. How the pieces fit together

```
   Browser (public/)                         Cloudflare
 ┌───────────────────────┐   fetch("/api/…")   ┌───────────────────────────────┐
 │ index.html  (page +CSS)│ ─────────────────▶ │ Pages Function                 │
 │ app.js      (all logic)│                    │ functions/api/[[path]].js      │
 │                        │ ◀───────────────── │   uses src/lib.js (rules,      │
 │ Google sign-in button  │       JSON         │   tokens, email helpers)       │
 └──────────┬─────────────┘                    └───────┬───────────────┬───────┘
            │ ID token from Google                     │ SQL           │ HTTPS POST
            ▼                                          ▼               ▼
      Google Identity Services                  D1 database       Google Apps Script
      (and tokeninfo endpoint,                  (SQLite)          (sends the email
       called by the server)                                       from a Gmail account)
```

- **Frontend** is plain HTML, CSS and JavaScript in `public/`. No framework, no build step. Cloudflare serves these files as they are.
- **Backend** is a single function file. Cloudflare runs it on demand for every URL that starts with `/api/`. This is called a *serverless function*: there is no server for you to keep running.
- **Database** is Cloudflare D1, which is SQLite hosted for you.
- **Email** goes out through a tiny Google Apps Script that you deploy from your own Google account, so no domain or paid mail service is needed.
- **Source of truth**: the server. If the browser and the server disagree, the server wins, because a user can always bypass the browser's checks.

---

## 4. Web dev concepts used here

A glossary of the ideas in this project, with where to see each one.

| Concept | Plain meaning | See it in |
|---|---|---|
| **Static hosting** | Files served as they are | `public/` |
| **Serverless function** | Code that runs per request on the host's machines | `functions/api/[[path]].js` |
| **File-based routing** | The file's path decides which URL it handles. `[[path]]` is a catch-all, so it receives every `/api/...` URL and `params.path` is the list of segments. | `functions/api/[[path]].js`, the `parts` variable |
| **REST-style API** | URLs for things, HTTP verbs for actions (GET reads, POST creates or acts, DELETE removes) | section 9 |
| **JSON** | The text format the browser and server use to exchange data | `json()` and `fail()` in `lib.js`, `api()` in `app.js` |
| **SQL and SQLite** | Relational database queries | `schema.sql`, every `env.DB.prepare(...)` |
| **Prepared statements** | SQL with `?` placeholders and `.bind(...)` so user input can never be run as SQL (prevents SQL injection) | every query in the function file |
| **Bindings, vars and secrets** | How Cloudflare hands the function its database and settings. Vars are public settings; secrets are hidden values. | `wrangler.toml`, `env.DB`, `env.SESSION_SECRET` |
| **OAuth / OpenID sign-in** | "Sign in with Google": Google gives the browser a signed ID token, and the server asks Google to confirm it | `verifyGoogle`, `mountGoogle`, `onCredential` |
| **HMAC-signed tokens** | A tamper-proof ticket: `payload.signature`. Only someone with the secret can make a valid one. Similar idea to JWT, built by hand with the browser's Web Crypto API. | `signToken`, `verifyToken` |
| **Authorization vs authentication** | Authentication = who are you (Google). Authorization = what may you do (staff or not). | `currentUser`, the `user.staff` checks |
| **Constant-time compare** | Comparing secrets in a way that doesn't leak how many characters matched | `safeEqual` |
| **Validation on the server** | Never trust the browser; re-check everything | `validateBooking`, `validateBatch` |
| **State and re-rendering** | One `S` object holds the app state; `render()` rebuilds the page's HTML from it | `S`, `render()` in `app.js` |
| **Event delegation** | One click listener on `document` that reads `data-act` attributes, instead of a listener per button | the click handler near the bottom of `app.js` |
| **Polling** | The page asks the server for fresh data every 20 seconds | `setInterval` in `init()` |
| **XSS and escaping** | Any user text put into HTML must be escaped, or it could run as code | `esc()` in `app.js`, `escapeHtml` in `lib.js` |
| **Time zones** | Dates are kept as `YYYY-MM-DD` strings, times as minutes after midnight, and "today" is computed for IST | `todayIST`, `start_min`, `end_min` |
| **Interval overlap** | Two ranges overlap when `startA < endB && endA > startB` | `validateBooking`, `approvedClashes`, `usedQty` |
| **Atomic batch writes** | Several INSERTs that all succeed or all fail | `env.DB.batch(stmts)` |
| **Fire-and-forget background work** | Send the response now, finish the email afterwards | `waitUntil(mail)` |
| **Migrations** | Changing a live database's shape safely | `migrations/001_fest_practice_period.sql` |
| **Unit tests without a framework** | Plain Node `assert` calls | `test/rules.test.js` |
| **Git branches and pull requests** | Each feature was a branch merged by PR | repo history |

---

## 5. Folder map

```
booking-portal-backstage/
├── public/                    ← what the browser downloads
│   ├── index.html             page skeleton + all the CSS
│   └── app.js                 the whole frontend (about 550 lines)
├── functions/
│   └── api/
│       └── [[path]].js        the backend: every /api/* route (about 190 lines)
├── src/
│   └── lib.js                 shared logic: rules, tokens, Google check, emails (about 280 lines)
├── apps-script/
│   └── Code.gs                the Google Apps Script that actually sends email
├── test/
│   └── rules.test.js          50 checks of the rules, tokens and email code
├── migrations/
│   └── 001_fest_practice_period.sql   one-time upgrade for older databases
├── schema.sql                 creates the database tables
├── wrangler.toml              Cloudflare config: DB binding, public settings
├── package.json               npm scripts and the one dev dependency (wrangler)
└── .gitignore                 keeps node_modules, .wrangler and .dev.vars out of Git
```

Why `src/lib.js` is separate from the function file: the pure logic (rules, dates, tokens, email text) has no Cloudflare-specific parts, so Node can import it and test it directly. The function file is only the "plumbing": read the request, call the logic, talk to the database, build a response.

---

## 6. Walkthrough of every file

### 6.1 `src/lib.js`: the shared brain

Read this first. Top to bottom:

| Piece | What it does |
|---|---|
| `CONFIG` | Every tunable rule (hours, lead days, limits, `eventsEnabled`). Sent to the browser via `/api/config` so both sides agree. |
| `RESOURCES` | The four bookable items: id, name, group (`lights` or `sound`), kind (`department` or `equipment`), quantity. Quantity is 1 each, so any overlap is a clash. |
| `json(data, status)` | Builds a JSON `Response` with `cache-control: no-store` (so booking data is never cached). |
| `fail(status, message)` | Shorthand for `json({ error: message }, status)`. The browser shows `error` to the user. |
| `todayIST(now)` | Today's date in India time. Adds 5.5 hours to UTC before taking the date, so "today" rolls over at midnight IST. |
| `addDays(dateStr, n)` | Adds days to a `YYYY-MM-DD` string using UTC maths (avoids daylight-saving surprises). |
| `isDate(s)` | True only for real dates in `YYYY-MM-DD` form (rejects `2026-02-31`). |
| `fmtMin(m)` | Minutes after midnight to `"HH:MM"` (private helper). |
| `toB64u` / `fromB64u` | Base64url encode and decode, the URL-safe form used in tokens. |
| `hmacKey(secret)` | Imports the secret as a Web Crypto HMAC-SHA-256 key. |
| `signToken(payload, secret)` | Makes `base64url(payload).base64url(signature)`. |
| `verifyToken(token, secret)` | Checks the signature and the `exp` expiry time. Returns the payload or `null`. |
| `safeEqual(a, b, secret)` | Compares two strings by comparing their HMACs, so timing doesn't reveal how much matched. Used for the staff password. |
| `emailAllowed(email, domain)` | True if the email ends in `@domain` or `.domain`. This covers `@pilani.bits-pilani.ac.in` too. |
| `verifyGoogle(credential, env)` | Sends Google's ID token to `oauth2.googleapis.com/tokeninfo`, then checks the audience matches your client ID, the email is verified, it hasn't expired, and the domain is allowed. Returns `{ email, name }` or `{ error, status }`. Returns status 502 if Google can't be reached. |
| `validateBooking(input, ctx)` | **The main rule checker for one booking.** Validates club, date, times, items, then type-specific rules (practice window, whole hours, 16:00 to 22:00, at most 2 hours), then clashes with pending and approved bookings. Returns `{ row }` or `{ error }`. `ctx` carries `today`, `fests` and existing `bookings`. |
| `practiceWindow(fest, today)` | Returns `{ lo, hi, closed }`, the first and last bookable day. `lo` is the later of the fest's custom open date and tomorrow; `hi` is the custom close date, or fest start minus 2 days. |
| `validateBatch(input, ctx)` | Handles a request with several `slots`. Runs `validateBooking` on each, feeding earlier slots in as "taken" so two slots in one request can't overlap. All-or-nothing, and the error names the slot ("Slot 2 (2026-10-30, 16:00-18:00): ..."). |
| `approvedClashes(booking, bookings)` | Names the items that an already-**approved** booking holds at the same time. Used when staff approve, because two pending requests can overlap but two approved ones can't. |
| `escapeHtml` | Escapes `& < > " '` for the HTML version of emails. |
| `buildDecisionEmail(booking, status, previous)` | Builds `{ subject, text, html }`. The wording is "confirmed", "declined" or "withdrawn" (rejected after being approved). Includes the desk's note if there is one. |
| `sendEmail(env, mail)` | POSTs the email to the Apps Script URL. Does nothing if the two mail secrets aren't set, and **never throws**, so an email problem can't break an approval. |

### 6.2 `functions/api/[[path]].js`: the backend

One exported function, `onRequest`, runs for every `/api/*` request. Helpers above it:

| Piece | What it does |
|---|---|
| `SESSION_SECONDS`, `STAFF_SECONDS` | Sign-in lasts 14 days; staff mode lasts 12 hours. |
| `mapBooking(row)` | Turns a database row (`start_min`, `created_by`) into the camelCase object the frontend uses (`startMin`, `createdBy`). Parses the `items` JSON text. |
| `NEEDS_MIGRATION`, `checkPracticePeriod` | Message for an old database missing the new columns, and a check that the open/close dates are valid and in order. |
| `readBody(request)` | Parses the JSON body, returning `null` instead of throwing if it's malformed. |
| `currentUser(request, env)` | Reads `Authorization: Bearer <session>` and `x-staff-token`, verifies both, and returns `{ email, name, staff }`. Staff is true only if the staff token is valid **and** was issued to the same email. |
| `loadBookings(env, today)` | Bookings from 60 days ago onward (max 3000), ordered by date and time. |
| `loadFests(env)` | All fests, mapped to `{ id, name, start, end, practiceStart, practiceEnd }`. |

Inside `onRequest`, the flow is:

1. Refuse if `SESSION_SECRET` is missing.
2. Split the URL into `parts` (for `/api/bookings/ab12/cancel` that's `["bookings","ab12","cancel"]`) and pick the `route` (first part).
3. **Public routes**: `GET config`, `POST login`.
4. **Everything else requires a signed-in user**, otherwise 401.
5. Route by `route` + `method` (full list in section 9).
6. A `try/catch` around everything turns unexpected errors into a friendly 500 and logs the real error for you.

Things worth noticing:

- **Booking creation** builds one `INSERT` per slot and runs them with `env.DB.batch(...)` so a multi-slot request is saved fully or not at all.
- **`decide`** only allows legal status changes: pending to approved or rejected; approved to rejected (withdraw); rejected to approved (re-approve). Cancelled bookings stay closed. Approving re-checks clashes against approved bookings (409 if blocked). Withdrawing without a note fills in "Approval withdrawn by the desk." After the database update it sends the email using `waitUntil`, so the desk's response isn't delayed by Gmail.
- **`cancel`** is allowed for the booking's creator or staff, and only while the booking is pending or approved.

### 6.3 `public/index.html`: page and styling

A skeleton (`<div id="app">`), the Google sign-in script tag (`accounts.google.com/gsi/client`), `<script src="/app.js">`, and all the CSS in one `<style>` block.

- **Design tokens**: colours, fonts and sizes are CSS variables on `:root` (for example `--lights` magenta, `--sound` teal). The dark theme redefines the same variables inside `@media (prefers-color-scheme: dark)`, so the rest of the CSS never mentions "dark".
- **Layout**: CSS grid for the two-column panels (`.cols`) with `auto-fit` so it collapses to one column on phones; the schedule timeline has horizontal scroll.
- **Accessibility**: visible `:focus-visible` outlines, real `<label>`s, `aria-selected` on tabs, `aria-pressed` on hour chips.

### 6.4 `public/app.js`: the frontend

The entire app is wrapped in an immediately-invoked function (`(function(){ ... })()`) so nothing leaks into the global scope.

**State**: one object `S` holds everything: current tab (`S.tab`), the signed-in user (`S.me`), fests, bookings, and the form state for the practice form (`S.pr`), the new-fest form (`S.fs`), per-fest period edits (`S.pp`), staff notes typed but not yet sent (`S.notes`), the "are you sure?" state (`S.confirm`), and a flash message (`S.flash`). Outside `S`: `session` and `staffToken` (the two tokens, mirrored in `localStorage` under `atd.session` and `atd.staff`).

**The loop**: *user acts, change `S`, call `render()`, `render()` rebuilds `app.innerHTML` from `S`.* There's no virtual DOM. To keep typing smooth, `render()` remembers which input had focus and the cursor position and restores them afterwards.

Functions by purpose:

| Group | Functions | Notes |
|---|---|---|
| Helpers | `esc`, `pad`, `iso`, `parse`, `addDays`, `today`, `toMin`, `fmtT`, `fmtD`, `fmtDL`, `cue` | `esc` escapes user text before putting it in HTML. `cue(b)` makes the short "Q-AB12" code shown on each card. |
| Availability | `resById`, `blocking`, `usedQty`, `freeQty`, `conflicts` | Counts how many of an item are used in a time range, so checkboxes can show Free or Taken, and the Desk can warn about clashes. |
| API | `api(path, opt)`, `load(quiet)`, `signOutLocal` | `api` attaches both tokens, parses JSON, throws on errors, and signs you out on a 401. `load` fetches `/api/state` and only re-renders when the data changed (it compares a JSON signature). |
| Views | `loginView`, `practiceView`, `scheduleView`, `mineView`, `deskView`, `bookView` (event page, unused while events are off) | Each returns an HTML string. `practiceView` has the fest picker, date, hour chips and slot cart. `deskView` has the Approvals and Fests sub-pages. |
| View pieces | `pickerHTML` (the department/equipment checkboxes), `bookingCard` (one booking, with whichever buttons the context needs), `periodCell` (a fest's Opens/Closes inputs), `laneLayout` (stacks overlapping bookings in lanes on the timeline) | |
| Practice helpers | `allSlots`, `upcomingFests`, `prWindow`, `hourCount`, `validatePractice` | `prWindow` is the browser's copy of the server's `practiceWindow`. |
| Sign-in | `mountGoogle`, `onCredential`, `staffLogin` | `mountGoogle` waits for Google's script and draws the button; `onCredential` sends Google's token to `/api/login`; `staffLogin` exchanges the password for a staff token. |
| Actions | `validate`, `submit`, `run`, `say` | `submit` validates, posts, clears the form and shows My bookings. `run(fn, okText)` is the wrapper for Desk actions: busy state, call, reload, flash message. `say` shows a flash message. |
| Events | one `click` listener, one `keydown`, `onField` on `input` and `change` | The click handler is a big `if (act === "...")` ladder keyed on `data-act`. `onField` writes input values into `S` using each input's `data-bind` path (like `pr.club`). |
| Start | `init` | Renders the login, fetches `/api/config`, loads state if you have a saved session, and starts the 20-second poll (only while the tab is visible). |

The browser repeats some checks (for instant messages), but a hand-made request can skip them. That's why the server runs the same rules again.

### 6.5 `apps-script/Code.gs`: sending the email

Not part of the Cloudflare app. You paste it into Google Apps Script and deploy it as a web app. Its `doPost` reads the JSON the portal sends, checks the shared secret against its own `MAIL_SECRET` script property, and calls `MailApp.sendEmail`. `reply` returns `{ ok: true|false }`, which `sendEmail` in `lib.js` reads. Mail comes from whichever Google account deployed it.

### 6.6 `schema.sql`, `migrations/`, `wrangler.toml`, `package.json`

- `schema.sql`: tables and indexes (see section 8). Safe to run again thanks to `IF NOT EXISTS`.
- `migrations/001_fest_practice_period.sql`: two `ALTER TABLE` lines for databases created before custom periods existed.
- `wrangler.toml`: the Cloudflare config. `pages_build_output_dir = "public"` says which folder to serve; `[[d1_databases]]` binds your database to `env.DB`; `[vars]` holds the public Google client ID and the allowed email domain. Secrets are **not** here.
- `package.json` scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site locally with a local database at http://localhost:8788 |
| `npm run db:init:local` | Creates the tables in the local database |
| `npm run db:init` | Creates the tables in the real (remote) database |
| `npm test` | Runs `test/rules.test.js` |
| `npm run deploy` | Manual deploy to Cloudflare Pages (normally unnecessary, since pushing to `main` deploys) |

---

## 7. Following one request end to end

**A club books two practice slots.**

1. **Sign in.** The Google button gives the browser an ID token. `onCredential` POSTs it to `/api/login`. The server's `verifyGoogle` asks Google to validate it, checks the college domain, and returns a signed 14-day `session` token. The browser keeps it in `localStorage`.
2. **Load.** `load()` calls `GET /api/state` with `Authorization: Bearer <session>` and gets back `{ me, today, fests, bookings }`. `render()` draws the page. A 20-second timer repeats this.
3. **Build the request.** On Practice slots the club picks a fest, a date, and an hour chip; **Add this slot** pushes `{date, startMin, endMin}` into `S.pr.slots`. They add a second slot, tick "Department of Lights", and press Send.
4. **Check in the browser.** `submit("pr")` calls `validatePractice()`, which checks the window, overlaps between slots, and whether each item is free.
5. **Send.** `api("bookings", {method:"POST", body})` sends `{type:"practice", club, title, festId, items, slots:[...]}`.
6. **Check on the server.** The function verifies the session, loads bookings and fests, and calls `validateBatch`. Each slot goes through `validateBooking`. Any failure returns 400 with a message naming the slot.
7. **Save.** One `INSERT` per slot, run together by `env.DB.batch`, each with status `pending`. The response is `201 { id, ids }`.
8. **Back in the browser.** The form clears, state reloads, the tab switches to My bookings, and a flash message appears.
9. **Staff review.** Staff open Desk, Approvals. `conflicts(b)` shows a warning if an approved booking already holds that item. They click Approve with an optional note, which POSTs `/api/bookings/<id>/decide` with `{status:"approved", note}`.
10. **Decide on the server.** The staff token is verified, the status change is checked as legal, `approvedClashes` is re-run, the row is updated with `decided_by` and `decided_at`, and `buildDecisionEmail` + `sendEmail` run in the background through `waitUntil`.
11. **Email.** `sendEmail` POSTs to the Apps Script URL; the script checks the secret and sends the message from Gmail. The club sees the new status on its next poll.

---

## 8. Database

Two tables, defined in `schema.sql`.

**`fests`**

| Column | Type | Meaning |
|---|---|---|
| `id` | TEXT, primary key | 10 random hex characters |
| `name` | TEXT | e.g. "Oasis" |
| `start`, `end` | TEXT | `YYYY-MM-DD`, first and last day of the fest |
| `practice_start`, `practice_end` | TEXT, optional | custom booking period; blank means the default rule |

**`bookings`**

| Column | Type | Meaning |
|---|---|---|
| `id` | TEXT, primary key | 10 random hex characters |
| `type` | TEXT | `'event'` or `'practice'` (CHECK constraint) |
| `club`, `title` | TEXT | who and what |
| `date` | TEXT | `YYYY-MM-DD` |
| `start_min`, `end_min` | INTEGER | minutes after midnight, so 16:00 is 960 |
| `items` | TEXT | JSON like `{"dept-lights":1,"equip-sounds":1}` |
| `fest_id` | TEXT | which fest (practice only) |
| `status` | TEXT | `pending`, `approved`, `rejected`, `cancelled` (CHECK constraint) |
| `note` | TEXT | the desk's note to the club |
| `created_by`, `created_by_name`, `created_at` | TEXT | who made it, and when (ISO timestamp) |
| `decided_by`, `decided_at` | TEXT | which staff account decided, and when |

Indexes on `date` and `created_by` keep the common queries fast.

Status flow:

```
            ┌────────── approve ───────────┐
            │                              ▼
 (new) → pending ── decline ──▶ rejected ◀── withdraw ── approved
            │                       │                        │
            └──── club cancels ─────┴──── approve again ─────┘ (rejected → approved)
                          ▼
                      cancelled   (final)
```

A "withdrawn" booking is not its own status. It is `rejected` plus a note (and the email wording checks the previous status).

Why times are stored as minutes and dates as text: it avoids time-zone and daylight-saving bugs, and `"2026-10-30" < "2026-11-03"` compares correctly as plain text.

---

## 9. API reference

All requests and responses are JSON. Errors look like `{ "error": "message" }`. "Session" means the `Authorization: Bearer ...` header; "Staff" additionally needs the `x-staff-token` header.

| Method and path | Auth | Purpose | Body, and result |
|---|---|---|---|
| `GET /api/config` | none | Rules and resources for the browser | `{ config, resources, googleClientId, domain }` |
| `POST /api/login` | none | Exchange a Google ID token for a session | `{ credential }`, result `{ session, user }` |
| `POST /api/staff-login` | session | Exchange the staff password for a 12-hour staff token | `{ password }`, result `{ token }` (403 if wrong) |
| `GET /api/state` | session | Everything the UI needs | `{ me, today, fests, bookings }` |
| `POST /api/bookings` | session | Create one booking, or several practice slots at once | `{ type, club, title, festId, items, slots:[{date,startMin,endMin}] }`, result `201 { id, ids }` |
| `POST /api/bookings/:id/cancel` | session (creator) or staff | Cancel a pending or approved booking | `{ ok: true }` |
| `POST /api/bookings/:id/decide` | staff | Approve, decline or withdraw | `{ status: "approved"\|"rejected", note }`; 409 if an approved booking already holds the items |
| `POST /api/fests` | staff | Add a fest | `{ name, start, end, practiceStart?, practiceEnd? }`, result `201 { id }` |
| `POST /api/fests/:id/period` | staff | Set or clear a fest's custom booking period | `{ start, end }` (null or blank clears) |
| `DELETE /api/fests/:id` | staff | Remove a fest | `{ ok: true }` |

Common status codes: 400 invalid input or illegal status change, 401 not signed in, 403 not allowed, 404 not found, 409 clash, 500 server problem, 502 couldn't reach Google.

---

## 10. Tests

```
npm install
npm test
```

`test/rules.test.js` has **50 checks** and needs no test framework: a tiny `t(name, fn)` helper runs each function and prints `ok - name`; any failed `assert` stops the run with an error. It covers:

- event rules (kept so you can switch events back on), including the on/off switch
- practice rules: window, whole hours, 2-hour cap, unknown fest
- multi-slot batches: all-or-nothing, overlap within a request, clash with existing bookings, the 10-slot limit
- custom practice periods and the default window
- `approvedClashes`
- the IST day rollover at 18:30 UTC
- the college email filter
- token signing, tampering, wrong secret, expiry, unicode names, `safeEqual`
- decision emails: wording for approved, declined and withdrawn; HTML escaping; no mail when unconfigured; webhook success, refusal and network failure

The tests set a fixed `today` (`2026-10-17`), so they don't depend on the real date. A few test names still say "14-day window" from an older rule; the behaviour they check is current.

The tests cover `src/lib.js` only. The function file and `app.js` were checked by running the site locally with `npm run dev` and clicking through it.

---

## 11. Setup and deployment

### One-time setup

1. **Cloudflare account**, then Workers & Pages, create a **Pages** project connected to this GitHub repo. Build command: none. Output directory: `public`.
2. **Create the database**: Storage & Databases, D1, create `main-audi-bookings`. Copy its ID into `database_id` in `wrangler.toml` (and commit).
3. **Create the tables**: open the database's Console and paste the contents of `schema.sql` (remove the `--` comment lines if the console complains). If you prefer the command line: `npm run db:init`.
4. **Google sign-in**: in Google Cloud Console, APIs & Services, Credentials, create an *OAuth client ID* (type Web application). Under **Authorized JavaScript origins** add your site's URL (`https://booking-portal-backstage.pages.dev`, plus `http://localhost:8788` for local testing). Put the client ID in `GOOGLE_CLIENT_ID` in `wrangler.toml`.
5. **Secrets**: Pages project, Settings, Variables and Secrets:

| Secret | Required | What it is |
|---|---|---|
| `SESSION_SECRET` | yes | A long random string used to sign sign-in tokens. Changing it signs everyone out. |
| `STAFF_PASSWORD` | yes | The shared password for the Desk |
| `MAIL_WEBHOOK_URL` | for emails | The Apps Script web app URL |
| `MAIL_WEBHOOK_SECRET` | for emails | Same value as `MAIL_SECRET` in the Apps Script |

6. **Deploy.** Secrets and `wrangler.toml` changes only apply to the next deployment, so push a new commit (or retry the latest deployment) after changing them.

### Deploying changes

Push to `main` and Cloudflare redeploys. Day-to-day work: make a branch, commit, open a pull request, merge.

### Decision emails

Staff decisions send the club an email with the date, time, items and any note. It's sent from a Google account through a small Google Apps Script, so no domain is needed.

1. Go to [script.google.com](https://script.google.com), click New project, and paste in `apps-script/Code.gs`.
2. Project Settings (the gear), Script properties, Add script property. Name `MAIL_SECRET`, value a long random string.
3. Deploy, New deployment, type **Web app**, Execute as **Me**, Who has access **Anyone**. Approve the permission prompts. Copy the Web app URL.
4. Add `MAIL_WEBHOOK_URL` (that URL) and `MAIL_WEBHOOK_SECRET` (the same random string) as Cloudflare secrets, then redeploy.

If either secret is missing, no emails are sent and everything else works. A failed email is logged and never blocks the decision. Gmail limits daily sends (about 100 on a personal account, more on a Workspace account). After editing the script, deploy it again as a **new version**.

### Running locally

```
npm install
npm run db:init:local     # once: create tables in the local database
npm run dev               # site at http://localhost:8788
```

Create a `.dev.vars` file (it is git-ignored) with your secrets:

```
SESSION_SECRET=any-long-random-text
STAFF_PASSWORD=choose-one
MAIL_WEBHOOK_URL=...        # optional
MAIL_WEBHOOK_SECRET=...     # optional
```

Local runs use a local copy of the database in `.wrangler/`. To reset it, delete that folder and run `db:init:local` again.

---

## 12. Operating the portal

### Adding a fest and a custom practice period

Desk, Fests. Add the fest's name and dates. Optionally fill **Practice opens** and **Practice closes**. For an existing fest, fill **Opens** and **Closes** in its row and click **Save period**. Leave both blank for the default (tomorrow until 2 days before the fest). The open date can't be earlier than tomorrow.

**If your database was created before custom periods existed**, run this once in the D1 console, one line at a time if needed:

    ALTER TABLE fests ADD COLUMN practice_start TEXT;
    ALTER TABLE fests ADD COLUMN practice_end TEXT;

Until you do, everything else keeps working; only saving a custom period shows a message asking for this update. New databases made from `schema.sql` already have the columns.

### Withdrawing and re-approving

In Desk, Approvals, upcoming approved bookings have a **Withdraw approval** button (with an optional note to the club); declined or withdrawn ones have **Approve again**. A withdrawn booking shows to the club as Declined, with the note. A booking the club cancelled itself can't be approved again. Approving is refused if an approved booking already holds the same department or equipment at that time.

### Changing a rule

Edit `CONFIG` in `src/lib.js` (for example `practiceMaxHours`), run `npm test`, then push. The browser fetches the values from `/api/config`, so you don't edit them twice. (`app.js` has a copy of `CONFIG` only as a first-paint fallback.)

### Bringing back event booking

Set `eventsEnabled: true` in `CONFIG`. The "Book an event" tab and the server rules come back together.

---

## 13. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "Sign-in is not set up yet" | `GOOGLE_CLIENT_ID` is still the placeholder or missing in `wrangler.toml`; redeploy. |
| "The server is missing SESSION_SECRET" | Add the secret in Cloudflare, then redeploy (secrets apply to new deployments only). |
| Google button appears but sign-in fails | The site's URL isn't in the OAuth client's **Authorized JavaScript origins**, or the email isn't a college address. |
| "Invalid database UUID" during deploy | `database_id` in `wrangler.toml` is still a placeholder. |
| Changes don't appear after a deploy | "Retry deployment" re-runs the *old* commit. Push a new commit instead. |
| "no such table: bookings" locally | Run `npm run db:init:local`. |
| "The database needs the one-time update..." | Run the two `ALTER TABLE` lines in section 12. |
| Pasting `schema.sql` into the D1 console fails with "incomplete input" | Remove the `--` comments. |
| No emails arrive | Check both mail secrets are set and redeployed; check the Apps Script was deployed as a web app (Execute as Me, access Anyone) and re-deployed as a new version after edits; look at the function logs for "Email failed"; check Gmail's daily limit. |
| A booking date looks one day off | Dates are IST. Check the `today` value from `/api/state`. |

---

## 14. Free-tier limits

Comfortably enough for one college's auditorium, but good to know:

- D1: about 5 million row reads/day, 100,000 row writes/day, 5 GB storage.
- Pages Functions: a daily request cap on the free plan. Every open tab polls every 20 seconds while visible, so many tabs left open add up. Check Cloudflare's current limits if traffic grows.
- Google Apps Script mail: daily recipient cap (see above).

---

## 15. Ideas for learning by extending it

Roughly easiest to hardest. Each one touches a different skill.

1. **Change a rule**: make practice slots 3 hours. Only `CONFIG` changes. Run the tests and see which fail and why.
2. **Fix a typo in the UI**: the Practice page's intro text is missing a full stop after "sound". Find it in `practiceView`.
3. **Add a field**: a "number of people" box on the booking. You'll touch the form (`app.js`), validation (`lib.js`), the INSERT and `mapBooking` (function file), and `schema.sql` plus a new migration.
4. **Add a test**: write one for a case you think is untested.
5. **Staff can add a booking on behalf of a club**: a new route and a new Desk form; practises authorisation.
6. **Email the staff when a request arrives**: reuse `sendEmail`; decide who the recipient is.
7. **A calendar view**: replace the day timeline with a week grid (`scheduleView`, `laneLayout`).
8. **Replace the shared staff password** with a `staff` table of emails and check it in `currentUser`.
9. **Refactor `app.js`** into ES modules (one file per view) and add a bundler; then compare how much complexity the "no build step" choice saved.
10. **Rewrite the frontend in a framework** (React, Svelte) while keeping the API unchanged. The API and `lib.js` are deliberately independent of the UI so this is possible.
