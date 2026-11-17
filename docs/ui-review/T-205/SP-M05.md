# SP-M05 — Change phone number (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7907 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/phone
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 24,012 of 224,400 (10.70%)
- **Side by side:** `SP-M05.png` (reference · built · heat map) — **heat map:** `SP-M05.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **Send a code is disabled, with a warning that says why.** The platform has no change-number route (no code to the old number, none to the new, no notice to the old). Building the button live would be a lie. Raised as an owner decision and a backend gap.
- **I can't get the code is real**: it opens the platform's lost-phone recovery request (`POST /auth/recovery-requests`, `LOST_PHONE`) with the current number typed, and says a person will check the ID within 24 hours.
- The reference prefills **Current number**; the platform has no read that returns the number, so it is typed. Both numbers are validated as Nigerian mobiles as typed, and the new one must differ.
- The three-step timeline is the ui-kit's `VersionTimeline`, drawn without the reference's card around it.
