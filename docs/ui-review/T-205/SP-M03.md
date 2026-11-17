# SP-M03 — Privacy & data (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7879 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/privacy
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 10,833 of 224,400 (4.83%)
- **Side by side:** `SP-M03.png` (reference · built · heat map) — **heat map:** `SP-M03.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference draws **three switches** (Camera, Location, Notifications). A web page cannot grant itself those permissions, so the rows state what the browser says ("Allowed", "Blocked in your browser", "Your browser asks first", "Set in your browser") and say where to change it. A switch that did nothing would be worse than none. Intended.
- **Download my data** is a real request (`POST /me/data-export`): a **Request** button on the row, then a banner with when it will be ready. **Delete my data** is a link to the close screens with `?erase=1`, because the platform's erasure request closes the account first.
- Added a **Close your account** group (the reference reaches CA1 from "Settings' danger zone", which has no screen of its own yet).
