# booking-portal-backstage
Booking portal for main audi
-

## Custom booking period for a fest

Staff can set when clubs may book practice for each fest: Desk, then Fests. Fill in "Opens" and "Closes" for a fest and click Save period, or set them when adding the fest. Leave both blank for the default (tomorrow until 2 days before the fest starts). The opening date can't be earlier than tomorrow.

**If your database was created before this feature**, run this once in the D1 console (Cloudflare dashboard, Storage & Databases, D1, your database, Console), one line at a time if needed:

    ALTER TABLE fests ADD COLUMN practice_start TEXT;
    ALTER TABLE fests ADD COLUMN practice_end TEXT;

Until you do, everything else keeps working. Only saving a custom period shows a message asking for this update. New databases created from `schema.sql` already have the columns.
-

## Withdrawing and re-approving

In the Desk's Approvals tab, staff see three lists: requests waiting for approval, upcoming approved bookings (each with a **Withdraw approval** button and an optional note to the club), and upcoming declined or withdrawn requests (each with **Approve again**). A withdrawn booking shows to the club as Declined, with the note. A booking the club cancelled itself can't be approved again. Approving is refused if an approved booking already holds the same department or equipment at that time.

-

## Decision emails

When staff approve, decline or withdraw a booking, the club that made it gets an email saying so, with the date, time, items and any note from the desk. The email is sent from a Google account through a small Google Apps Script, so no domain is needed.

1. Go to [script.google.com](https://script.google.com), click New project, and paste in the contents of `apps-script/Code.gs`.
2. Open Project Settings (the gear), then Script properties, then Add script property. Name it `MAIL_SECRET` and give it a long random value.
3. Click Deploy, then New deployment, pick the type Web app, set Execute as to Me and Who has access to Anyone, and deploy. Approve the Google permission prompts. Copy the Web app URL.
4. In Cloudflare, add two secrets to the Pages project (Settings, Variables and Secrets): `MAIL_WEBHOOK_URL` (the Web app URL) and `MAIL_WEBHOOK_SECRET` (the same value as `MAIL_SECRET`). Then redeploy.

For local testing, put both in a `.dev.vars` file. If either is missing, no emails are sent and everything else works as before. A failed email is logged and never blocks the decision. Google limits how many emails an account can send per day (about 100 for a personal Gmail account, more for a college Google Workspace account). After editing the script, deploy it again as a new version.
