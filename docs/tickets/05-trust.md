# Epic 05 — Trust & verification (M6)

Spec: `docs/specs/module-06-trust-and-verification.md`. Provider credentials do not exist yet (design §12 Q7).

---

### T-050 — Verification core: NIN/BVN, liveness, levels

- **Touches:** `src/modules/trust/**`, migration `trust_*`
- **Depends on:** T-040, T-045, T-031
- **Acceptance criteria:**
  - Schema per M6 §6 (requests, NIN/BVN outcomes, liveness, provider call log, append-only level change log).
  - Raw NIN/BVN never stored or logged: masked display value plus keyed HMAC plus provider reference only. A test scans logs and tables after a verification run for the raw number.
  - `KycProviderAdapter` with a deterministic fake (dev/test) and a Dojah adapter disabled until credentials exist (feature flag).
  - Verification runs asynchronously in jobs; results push to the client over the socket.
  - `verification.level_attained` and `.level_revoked` drive `users.verification_level` in identity; level 2 requires NIN or BVN plus liveness.
  - Endpoints per M6 §11 user surface; status endpoint for J2 and VF1.

### T-051 — Business verification, bank name-match, address, social proof

- **Touches:** `trust/services/{business,bankMatch,address,socialProof}.service.ts`
- **Depends on:** T-050
- **Acceptance criteria:**
  - CAC verification (SO3, M2), bank account name-match used by payout accounts (T-073), address proof, Instagram/X social-proof challenge.
  - Level 3 requires level 2 plus CAC plus business bank match.
  - Rejection reasons structured for BVR1 and VF1.

### T-052 — Duplicate identity detection and KYC review queue

- **Touches:** `trust/services/{duplicate,review}.service.ts`, `trust/http/admin.controller.ts`
- **Depends on:** T-050, T-037, T-107
- **Acceptance criteria:**
  - Duplicate NIN/BVN/CAC handling per M6 §7: never auto-approve or auto-reject; flag plus review case.
  - KYC and KYB review items register as cases (`IDENTITY`, `KYB`) in the universal case model, with an advisory suggestion.
  - `verification.override` only through dual approval.
  - Two rejections within 30 days auto-open a support ticket (event to T-100).
