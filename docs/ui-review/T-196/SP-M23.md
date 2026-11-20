# SP-M23 — Withdraw a dispute (T-196)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11406 — Supporting · Trade extras
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/dispute/withdraw
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,605 of 224,400 (11.41%)
- **Side by side:** `SP-M23.png` (reference · built · heat map) — **heat map:** `SP-M23.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-mediation`, buyer (the opener), `/trade/<id>/dispute/withdraw`. The form is drawn, not the refusal.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Title bar.** The reference right-aligns "Withdraw" in its top bar (the frame is drawn that way); the built title is centred like every other screen.
- **Reason picker.** The built screen labels the group "Why are you closing it?" above three options, none selected; the reference has no label and pre-selects "We sorted it out together". Same three options.
- **What happens.** Same three steps. "Your inspection window keeps running" says "Where the trade still has one" instead of "41h left": the inspection window is not read here. Intended (README).
- **Actions.** "Withdraw the dispute" and "Keep it open" are in the page flow, below the note; the reference pins them.
