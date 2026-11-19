# VF1 — Verification Failed (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7284 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/account/verification
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 28,187 of 224,400 (12.56%)
- **Side by side:** `VF1.png` (reference · built · heat map) — **heat map:** `VF1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's row says "Government-issued ID" and uploads a photo. The platform's identity check is a NIN or BVN with the name, plus a liveness selfie, so the row names the check that failed (the shot is the **selfie** check, whose resubmit is exactly the reference's "Upload a clearer photo") and a failed NIN or BVN gets an ID number and name form instead.
- The banner's heading and body are **the platform's own copy** (`whyHeading`, `why`), not the screen's.
- Added: "We're checking" when a newer attempt is in flight (the failure it replaces is dropped), "What's needed", and an empty state. **Contact support instead** shows the support reference. Business, address and social rejections show their reason with no resubmit: those screens belong to other tickets.

**Follow-up to F-045 (liveness abandon + wide screens)**

- The failed-selfie retry is no longer the reference's "Upload a clearer photo" dropzone. Since
  F-045 a liveness verdict only ever arrives on a signed Youverify webhook, so an uploaded file
  could produce no decision at all; the retry now reopens the provider SDK. The reference frame
  still draws the dropzone, and the heat map will show it — **intended**.
- **Desktop and tablet are a deviation by construction.** `SCREEN_INDEX.md` indexes VF1 as
  _Mobile Web_ and the v2 master draws no wide frame for it, so there is nothing to diff against
  above the mobile column. Rather than invent a verification-specific desktop language, the screen
  follows the house treatment already used by `HomeScreen` and `Payouts`:
  `max-w-[480px] md:max-w-[760px] lg:max-w-none`, with "What's needed" moving from under the
  action to a 320px column beside it at `lg`. Base is byte-for-byte the mobile layout the
  reference does draw, so the existing mobile check stays valid.
- Owner call outstanding: if a bespoke desktop VF1 is ever drawn, this house grid is what it
  replaces.
