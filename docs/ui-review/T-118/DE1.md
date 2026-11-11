# DE1 — Request More Time (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4770 — Delivery Extension — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000203/extend
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 28,221 of 224,400 (12.58%)
- **Side by side:** `DE1.png` (reference · built · heat map) — **heat map:** `DE1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **Reasons are plain radio rows**, not the reference's outlined option cards; the same three reasons the platform lists, nothing more.
- **The new date is a date-and-time field** (the platform takes an instant), not a free-text "Tomorrow, by 6:00 PM". Send stays disabled until a reason and a later date are given.
- **The banner says the date**, not "due in 6 hours", for the same reason as the countdown strip elsewhere.
- Item card shows the item and price; the reference's "Due today · buyer name" line is the banner above it.
- The cap (one original window, once per deadline) is the platform's and is shown in its own words when it refuses.
