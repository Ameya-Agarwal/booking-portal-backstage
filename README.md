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
