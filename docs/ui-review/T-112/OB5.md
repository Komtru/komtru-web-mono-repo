# OB5 — You're All Set (T-112)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2606 — First-Time Onboarding Walkthrough — Mobile Web · Complete Flow
- **Built:** http://localhost:3143/welcome/done
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 2,560 of 224,400 (1.14%)
- **Side by side:** `OB5.png` (reference · built · heat map) — **heat map:** `OB5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**One intended difference:** the reference greets "Amaka", a sample name. The built heading says the first name typed at sign-up (kept for this screen only) and reads "You're all set" when none is known, as in this shot, so the name line differs by design. "Enter a Trade Code" opens a field in place (not drawn: v2 has no code-entry screen) and goes to `/trades/<code>`.
