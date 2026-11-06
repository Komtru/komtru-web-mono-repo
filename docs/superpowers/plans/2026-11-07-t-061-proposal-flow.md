# T-061 Proposal flow — plan

Scope: `apps/backend-api/src/modules/trades/{domain,services,http}` plus migration 0039. Test first, commit per green step.

## Shape

- `domain/proposal.ts` (pure): proof-media check against the category standard, turn rules, counterparty side.
- `services/proposal.service.ts`: preview (Z3), create (draft + terms v1, G1/Z2 item spec check), send, counter-propose (W2/BR1), accept (W1/W3, fee snapshot), claim invitation, expire invitation.
- `services/trade.service.ts`: read a trade, decline (SD1), cancel (CT1).
- `http/`: routes under `/trades`, mounted by `createTradesModule`, registered in `modules/index.ts`.
- Every transition goes through `applyTransition`; each writes a `trade_activity` row and publishes through it. A repeated action by the same actor returns the trade as it stands (idempotent replay); routes are `retryable: true` so the platform Idempotency-Key also applies.

## Migration 0039

- `trade.trade_proof_media(trade_id, file_id, attached_by_user_id)` — seller proof, one row per file.
- `trade_terms_versions.delivery_address` / `ships_from_address` become nullable (at least one present): a proposal carries the proposer's own side, the other side is filled by whoever accepts or counters, because nobody can snapshot an address the counterparty has not yet chosen.

## Rules

- Role chosen per trade; a certified merchant asking for BUYER is refused (`MERCHANT_CANNOT_BUY`, recorded). Naming a certified merchant as buyer is refused at send; `canBuy` re-checked at accept and claim.
- Acceptance fills the acceptor's address by writing a new terms version (the accepted one), snapshots fees (`snapshotFees`) and pins the version.
- No PENDING_PAYMENT without seller proof (count/video per the category's `proofMedia`) and both addresses.

## Owner decisions pending

1. Proof media files: M20 has no TRADE_PROOF category. Accepted: seller-uploaded, READY, ACTIVE, `PRIVATE_CASE` files (e.g. DISPUTE_EVIDENCE), with the buyer granted access via `grantAccess`. A dedicated category is a files-module follow-up.
2. UNDER_PROPOSAL_REVIEW (risk hold, G3) is not entered: no risk module yet, send goes straight to AWAITING_ACCEPTANCE / PENDING_COUNTERPARTY.
3. Cancel allowed to either bound party (and the initiator before binding), per M7 D3 / CT1.
4. Payment deadline (EXPIRE from PENDING_PAYMENT) is not set here (no documented duration); left to the funding ticket.
5. `deliveryGraceHours` is read from setting `trades.unconfirmed_delivery_grace_hours` (M7 D4).
