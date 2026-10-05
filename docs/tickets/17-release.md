# Epic 17 — Integration, hardening and release

---

### T-180 — End-to-end critical paths
- **Depends on:** T-123, T-118, T-173, T-162, T-148
- **Acceptance criteria:** Playwright suites across apps against a real backend: (1) sign up → propose → seller accepts with proof → fund → ship via Park → drop-off PIN → arrival → inspection → pickup PIN → buyer confirms → settled → hub earns ₦300 → hub withdraws; (2) the same through a courier company including one rejection and re-selection; (3) self-arranged shipping with a dispute resolved by mediation; (4) PIN mismatch three times → custody case → TrustOps clears → release. All green twice in a row.

### T-181 — Load and resilience
- **Depends on:** T-180
- **Acceptance criteria:** two API instances behind a local load balancer with PgBouncer; k6 smoke on list endpoints and the PIN limiter; kill the worker mid-flight and prove outbox delivery and job retry recover with no double posting.

### T-182 — Security review
- **Depends on:** T-180
- **Acceptance criteria:** security review pass over the whole repo; secret scan of the full history; dependency audit with no high or critical findings unresolved; confirm `docs/specs/backend-apis.env` never entered history.

### T-183 — Definition-of-done audit and first push
- **Depends on:** every other ticket
- **Acceptance criteria:** each Definition-of-Done line in the master prompt checked with evidence linked from `docs/TICKETS.md`; final review pass; push to the remote confirmed in design §12 Q1, only after the owner's go-ahead.
