# Logistics portal — Team (T-161)

- **Reference:** none (see T-160's record). Checked for design-system conformance.
- **Built:** `apps/logistics-ops` `/team`, production build on port 3965 against the visual stand-in on 7965,
  signed in as the stand-in's `courier-admin` and `courier-operator` personas (fixture company Swift Couriers).
- **Shots (not committed):** `team-admin-desktop.png`, `team-operator-desktop.png`, `team-admin-tablet.png`
  (`pnpm visual-capture --persona courier-…`); `invite-linked.png`, `invite-pending.png`, `last-admin.png`
  (a scratch Playwright script answering the invite and role-change calls in the browser).

## Conformance

- Drawn in `ConsoleShell` (the desktop console shell), brand label "Komtru Logistics", one rail item
  (Team) and Sign out in the rail footer, exactly as `operations-app`'s `ConsoleFrame` composes it.
  The page head names the company: "Swift Couriers · Who can sign in to the portal".
- Invite form: `Card` (stack), `TextField`, `Select` with a helper line per role, primary `Button`.
- Roster rows: `Card` (row) with the name, role and masked contact, a `Chip`, and `ghost` buttons;
  group headings are `SectionLabel`. Chip tones: Active `verified`, Not signed in yet `awaiting`,
  Not signed up yet `verifying`, Expired `risk`.
- The two invite outcomes are distinct Banners: `success` "Added — Kemi Bala can log in now" (LINKED)
  and `info` "Pending — they get access once they sign up with this email or phone" (PENDING), the
  latter telling the admin to tell the person themselves, since nobody without an account can be messaged.
- `409 LAST_ADMIN` is a `warning` Banner titled "Promote someone else first".
- An operator sees the roster and an `info` Banner; no form, no row buttons.
- Removal asks first: the row swaps its buttons for a `danger` "Remove <name>" and Cancel.

## Deviations

- The `danger` Button is full-width by default (`.btn-danger`); in a roster row it is given `w-auto`,
  the same override the reference writes for a page-head `.btn-primary`.
- The three `team-*.png` shots predate the last copy change (role option labels shortened to
  "Operator" / "Admin" with a helper line); `invite-*.png` and `last-admin.png` show the current form.
