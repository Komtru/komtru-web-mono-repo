# SDD ledger — plan: docs/superpowers/plans/2026-10-06-t-036-devices-mfa.md
Pre-flight: Task 4 consumes RelyingParty/WebauthnChallengeStore produced by Task 6 (types only, in MfaDeps) — forward type reference is fine in TS; Task 7 consumes activeFactors+mfaRequirement from Tasks 3/4 — names match; Task 5 consumes FactorRow from Task 4 — matches; Task 8 consumes all. Clean.
