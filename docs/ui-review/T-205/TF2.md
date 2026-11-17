# TF2 — Save Your Backup Codes (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` (see `SCREEN_INDEX.md`)
- **Not shot:** in-flow state the harness cannot set.

## Deviations

Not shot: TF2 is in-flow state (the codes exist only in the memory of the screen that activated the factor, shown once), which the harness cannot set. Held by `test/two-factor.test.tsx` (the codes, "Shown once", the axe check) and `test/security.test.tsx` (new codes after a step-up).
