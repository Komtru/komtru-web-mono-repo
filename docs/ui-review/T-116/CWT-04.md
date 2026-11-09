# CWT-04 — Workspace — Inspection (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10701 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000004
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,462 of 224,400 (10.01%)
- **Side by side:** `CWT-04.png` (reference · built · heat map) — **heat map:** `CWT-04.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No "Inspect & compare" or "Report an issue" buttons, and no "request eligible additional time".** All three are F-027. The screen says so in one line and draws no control.
- **"Inspection remaining · 41h 22m" is "Inspection ends · <date and time>".** A count would be wrong a minute later and there is no ticking clock yet; the deadline is the platform's, in Lagos time.

**Real differences**

- Tab strip and item line as in CWT-01.
- **"Policy minimum · 48 hours" is "Window · 48 hours"**: the trade's own window, which is the standard's at the time it was agreed. The drawn "minimum" wording is policy copy with no API source.
- The drawn hero is the amber warning for the buyer; the seller sees a plain note instead (the seller has nothing to do), which the reference does not draw.
