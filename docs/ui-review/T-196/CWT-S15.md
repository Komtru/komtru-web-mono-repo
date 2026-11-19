# CWT-S15 — Resolution — Case Status & Settlement (T-196)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11128 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3916/trade/0190b0a0-0000-7000-8000-000000000504/dispute/status
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 28,022 of 224,400 (12.49%)
- **Side by side:** `CWT-S15.png` (reference · built · heat map) — **heat map:** `CWT-S15.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**The built page is the app's error state, not the case status.** The shot shows "This page didn't load" (Try again, Go to Trades). The drawing's case card, financial state and "What's happening" steps are not in the built shot.

**Cause, from the app's server log.** `Functions cannot be passed directly to Client Components`, raised while the page renders. `app/(app)/trade/[id]/dispute/status/page.tsx` passes a `render` function through `DeliveryPage` into `WithDispute`, a client component (`src/trade/dispute/DisputeScreen.tsx`). No request reaches the stand-in for this page, so the fixtures are not the cause. This is an app defect for the owner to decide on. It was not changed here. The Y1 route (`dispute/evidence`) fails the same way.

**Score.** The 12.49% compares the drawing against the error card. It does not measure CWT-S15.
