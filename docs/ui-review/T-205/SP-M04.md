# SP-M04 — Security & devices (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7893 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/security
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 8,544 of 224,400 (3.81%)
- **Side by side:** `SP-M04.png` (reference · built · heat map) — **heat map:** `SP-M04.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's **Password** row ("Changed 2 months ago") is not built: the platform has no password-changed date to state, and no change-password screen is in T-205's ten. Intended; raised in the report.
- The reference's **App lock** row ("PIN or fingerprint when you open Komtru") is not built: an app lock is a feature of the phone apps, not a browser. Intended.
- **Two-step sign-in** is a locked switch when on (aria-readonly) and the methods below carry their own Remove, each with its own step-up proof: a switch that removed them all at once would be a way round the proof. Added rows: the methods, Backup codes (left, and Get new codes), and a Phone number row to SP-M05.
- Devices come from `GET /me/devices`; the reference's "Lagos" place is not sent by the platform, so the line reads "Last used 3 days ago". The reference marks a chevron on the other device; here it is a **Remove** button (`DELETE /me/devices/:id`).
- "Sign out of other devices" revokes every other session one by one and says how many are left.
- **Accepted scope cut:** there is no way here to add a text-message second method; only an authenticator app can be added (the platform's SMS enrolment is built and not surfaced). Tracked as a follow-up.
- Added: a **Phone number** row that opens SP-M05.
