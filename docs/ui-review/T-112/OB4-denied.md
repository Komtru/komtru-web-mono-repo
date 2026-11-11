# OB4 — Enable Notifications (T-112)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2585 — First-Time Onboarding Walkthrough — Mobile Web · Complete Flow
- **Built:** http://localhost:3143/welcome/notifications
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 29,485 of 224,400 (13.14%)
- **Side by side:** `OB4.png` (reference · built · heat map) — **heat map:** `OB4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Not in the reference.** The state a browser that has blocked notifications (or has none) gets: the reference's copy stays, a note under it says notifications are blocked in the browser and where choosing channels lives, and the two buttons become one "Continue", because "Allow" would do nothing. Headless Chromium reports `denied`, so this is what the first shot caught. The reference does not draw it, which is the whole difference.
