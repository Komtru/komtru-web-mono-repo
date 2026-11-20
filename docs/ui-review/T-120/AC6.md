# AC6 — File an Appeal (T-120)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5375 — File an Appeal — Mobile Web
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/appeal
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 32,953 of 224,400 (14.68%)
- **Side by side:** `AC6.png` (reference · built · heat map) — **heat map:** `AC6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-decided`, buyer, `/trade/<id>/appeal`, inside the appeal window. The form is drawn (not the refusal), which is the case the screen is for.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Banner.** Same text as the reference, in an info banner; the built one sits slightly inset because the shell adds its own padding.
- **Textarea.** The reference shows a filled example; the built field is empty with a placeholder and a hint ("Only what wasn't already part of the original case."), and the submit button is disabled until it has words. Intended.
- **Evidence uploader.** The reference draws "New evidence (optional) — Add new evidence". The built screen has no uploader. **Real gap, not changed:** as Customer-7. The appeal endpoint is not told of files either, so this one needs a contract decision as well as the upload UI.
- **Back to the case.** The built screen adds a secondary "Back to the case" the reference does not draw.
