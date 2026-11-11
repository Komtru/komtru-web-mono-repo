# OB4 — Enable Notifications (T-112)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2585 — First-Time Onboarding Walkthrough — Mobile Web · Complete Flow
- **Built:** http://localhost:3143/welcome/notifications
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 4,546 of 224,400 (2.03%)
- **Side by side:** `OB4.png` (reference · built · heat map) — **heat map:** `OB4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shot with the browser's permission forced to `default`** (a script the proxy injects), because headless Chromium reports `denied`, which is a different state (below). Text anti-aliasing only; the bell, copy, and the stacked Allow / Not now pair match. Clicking Allow asks the browser; a grant registers the device only when a push token source exists (none yet: plan, owner question 1) and then continues to OB5.
