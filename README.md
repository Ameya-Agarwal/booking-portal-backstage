# booking-portal-backstage
Booking portal for main audi
-

## Booking emails

Requesters receive a confirmation at their signed-in Google email after submitting a booking. Multi-slot requests get one email listing all slots. Each subsequent approval or denial sends an update for the affected booking, including withdrawn approvals and re-approvals. Emails include the club/department, booking title and reference, date, start/end time in IST, current status, and any staff note. The database's `rejected` status is shown as **Denied** in emails.

### Team recipients

Edit `config/notification-recipients.json`. All three teams currently use the supplied address `f20230013@pilani.bits-pilani.ac.in`; duplicate copies are removed. Replace each team's list when separate addresses are available, for example (these are placeholders):

```json
{
  "backstage": ["backstage@example.com"],
  "lights": ["lights@example.com"],
  "sounds": ["sounds@example.com", "sounds-lead@example.com"]
}
```

Backstage receives every submission and approval/denial update. Lights receives these emails when Department of Lights or Lights Equipment is selected; sounds receives them when Department of Sounds or Sounds Equipment is selected. Selecting both notifies both teams. The requester remains in `To`, and teams receive a BCC copy of the same confirmation, including the requested resources. Duplicate addresses (including the requester's address) are removed case-insensitively. An empty array disables copies for that team. Cancellation emails are not included.

This JSON is imported by the server, outside `public/`; it is not a browser-editable recipient list. Addresses committed here are visible to anyone who can read the repository. Use team mailboxes if appropriate. Do not put API keys in this file. Recipient changes require a new deployment.

Email uses the [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email). To enable it:

1. Create a Resend account, verify a sending domain you control, and create an API key with sending permission.
2. Set these Cloudflare Pages secrets (enter the values when prompted):

   ```sh
   npx wrangler pages secret put RESEND_API_KEY --project-name main-audi-bookings
   npx wrangler pages secret put BOOKING_EMAIL_FROM --project-name main-audi-bookings
   ```

   For `BOOKING_EMAIL_FROM`, use a sender on your verified domain, such as `Main Audi Bookings <bookings@example.com>`.
3. Deploy the updated application with `npm run deploy`. Configure the same secrets for preview environments if needed.

For local development, put `RESEND_API_KEY` and `BOOKING_EMAIL_FROM` in the gitignored `.dev.vars` alongside the existing session secrets. Local runs with real credentials send real email.

Emails are sent only after the database write succeeds. Missing configuration, provider errors, or a 10-second timeout show a warning in the portal; the booking or decision remains saved. Failed emails are logged with booking references and are not automatically retried. Provider acceptance does not guarantee inbox delivery; use Resend's delivery logs to investigate. No database migration is required.

### Pull request, merge, and rollout

1. Fill in the real team addresses in the JSON above. Use Node.js 22.12+ (or Node.js 24) for the JSON import syntax used by the tests. From the project root run:

   ```sh
   npm ci
   npm test
   git diff --check
   git status --short
   git diff
   ```

2. The feature branch is currently `adding-email-verificaiton` (spelling as it exists). Stage the full email feature, review the staged diff, commit, and push:

   ```sh
   git add README.md config/notification-recipients.json src/email.js test/email.test.js 'functions/api/[[path]].js' public/app.js package.json wrangler.toml
   git diff --cached
   git commit -m "Send booking confirmations to requesters and relevant teams"
   git push -u origin adding-email-verificaiton
   ```

3. In GitHub, open `Ameya-Agarwal/booking-portal-backstage`, choose **Pull requests > New pull request**, set base to `main` and compare to `adding-email-verificaiton`. Suggested title: **Send booking confirmations to requesters and relevant teams**. Describe submission and decision emails, JSON routing, required Resend secrets, and failure warnings. Record `npm test` results and state that live delivery must still be checked. Review the Files changed tab and confirm no API keys or `.dev.vars` are included. Request review and wait for configured checks. See [GitHub's PR guide](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request).

4. Before merging, configure Resend and the production Pages secrets using the instructions above, because a Git-connected Pages project may deploy immediately on merge. The sender domain must be one you control: enter the DNS records shown by Resend, wait for verification, and choose a sender on that domain. Recipient college domains do not need to be your sending domain. A test sender is insufficient for arbitrary team recipients.

5. Once reviewed, use **Squash and merge** if available (or the repository's required merge method), then confirm the merge. If conflicts occur, resolve them on the feature branch and rerun tests before merging.

6. If Cloudflare Pages is connected to GitHub, verify its production branch is `main`, framework preset is None, root is the repository root, and output directory is `public`. There is no frontend build step; leave the build command blank. Verify the existing `DB` D1 binding and authentication secrets are still configured. Wait for the deployment of the merged commit to succeed; redeploy after changing secrets. Do not upload only `public/` through dashboard drag-and-drop, because the API needs Pages Functions. See [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Function bindings](https://developers.cloudflare.com/pages/functions/bindings/).

7. If you deploy manually instead, deploy from the merged `main` branch:

   ```sh
   git switch main
   git pull --ff-only origin main
   npm ci
   npm test
   npm run deploy -- --branch main
   ```

   Ensure `main` is the Pages project's production branch. The deploy command bundles the root `functions/` directory, including the imported recipient JSON.

8. On the deployed site, submit a lights-only booking: requester, backstage, and lights should receive it, while sounds should not. Repeat with sounds-only and both resources. Approve and deny a booking and confirm the same relevant recipients receive its new status and staff note. Check spam folders and Resend delivery logs, not only the portal success message. For preview testing, configure preview secrets and a separate preview D1 database first; preview emails with real credentials go to the real configured recipients.

No new database migration or schema reset is needed for email notifications. If a notification fails, the booking remains saved; do not submit a duplicate booking to resend it. Check the Pages Function logs and Resend logs, fix the configuration, and redeploy as needed. Automatic resend is not implemented.

## Custom booking period for a fest

Staff can set when clubs may book practice for each fest: Desk, then Fests. Fill in "Opens" and "Closes" for a fest and click Save period, or set them when adding the fest. Leave both blank for the default (tomorrow until 2 days before the fest starts). The opening date can't be earlier than tomorrow.

**If your database was created before this feature**, run this once in the D1 console (Cloudflare dashboard, Storage & Databases, D1, your database, Console), one line at a time if needed:

    ALTER TABLE fests ADD COLUMN practice_start TEXT;
    ALTER TABLE fests ADD COLUMN practice_end TEXT;

Until you do, everything else keeps working. Only saving a custom period shows a message asking for this update. New databases created from `schema.sql` already have the columns.
-

## Withdrawing and re-approving

In the Desk's Approvals tab, staff see three lists: requests waiting for approval, upcoming approved bookings (each with a **Withdraw approval** button and an optional note to the club), and upcoming declined or withdrawn requests (each with **Approve again**). A withdrawn booking shows to the club as Declined, with the note. A booking the club cancelled itself can't be approved again. Approving is refused if an approved booking already holds the same department or equipment at that time.
