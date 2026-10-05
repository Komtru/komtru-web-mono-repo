# Epic 09 — Disputes (M3)

Decision C13 (design §5): a 48-hour mediation window comes first, from HTML Y1.

---

### T-080 — Disputes core

- **Touches:** `src/modules/disputes/**`, migration `disputes_*`
- **Depends on:** T-065, T-040, T-074, T-075, T-107
- **Acceptance criteria:**
  - States `MEDIATION` (new, `disputes.mediation_window_hours`), `OPEN_EVIDENCE_COLLECTION`, `UNDER_REVIEW`, `DECIDED`, `APPEALED`, `APPEAL_UNDER_REVIEW`, `CLOSED`, with `canTransition` and 409s.
  - Both creation paths (direct filing from a disputable trade state; ticket escalation) converge on one case; at most one non-closed dispute per trade (partial unique index).
  - Mediation: parties propose and accept one of M3's four money outcomes; an agreed outcome skips review and resolves; otherwise the window lapse escalates to evidence and review. "Replacement" and "refund with return" are recorded as agreed notes with self-arranged return shipping (Q10 default).
  - Evidence window equal for both parties; late evidence requires a logged reopen.
  - Reviewer assignment excludes parties and anyone sharing a device or payout instrument with them; appeals go only to `DISPUTE_LEAD`, never the original reviewer; one appeal only.
  - Decision log append-only; DB trigger enforces buyer + seller amounts = escrowed item amount.
  - Events per M3 §6 drive trades (`RESOLVED_*`) and ledger (split, release, refund); disputes register as `DISPUTE` cases with advisory.
  - Evidence files use `DISPUTE_EVIDENCE` with `PRIVATE_CASE` grants for the parties and the assigned reviewer.

### T-081 — Evidence comparison and dispute read models

- **Touches:** `disputes/services/evidence.service.ts`, `disputes/http/**`
- **Depends on:** T-080
- **Acceptance criteria:**
  - Side-by-side data for Y1 and Z6: seller's pre-shipment proof (from acceptance, W1), buyer's unboxing evidence, custody photos when the trade went through Park, the shipment or parcel timeline, and the mediation countdown.
  - Consumer views for C7, C8, H1, H2, AC6, S7, S8; reviewer queue and case endpoints per M3 §9, paginated.
  - Resolution copy distinguishes buyer and seller framing ("corrective, not negative", H2).
