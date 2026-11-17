# TF1 — Set Up Two-Factor (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7402 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/account/security/two-factor
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 29,876 of 224,400 (13.31%)
- **Side by side:** `TF1.png` (reference · built · heat map) — **heat map:** `TF1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **No QR code.** The reference draws one. This app has no QR encoder and adding a dependency is the owner's decision (a `qrcode` install was declined in this run). The key is shown typed, grouped as the reference groups it, with an **Open in your authenticator app** link (the `otpauth` URI), which a phone's authenticator opens directly. Open question for the owner.
- The six code boxes are empty at first (the reference is mid-entry), and **Verify & enable** is disabled until six digits are in. The key is the platform's, returned once when the screen opens; it is not in the cache or the URL.
- The intro reads "Add this to…" rather than "Scan this with…", because there is nothing to scan.
