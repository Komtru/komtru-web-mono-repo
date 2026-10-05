# Epic 06 — Merchant management and discovery (M5, M19)

---

### T-055 — Merchant applications and certification

- **Touches:** `src/modules/merchant/**`, migration `merchant_*`
- **Depends on:** T-050, T-051, T-049, T-040, T-073, T-107
- **Acceptance criteria:**
  - `merchant_applications` with status `DRAFT`, `SUBMITTED`, `IN_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`; at most one live application per user (partial unique index); append-only status and decision log.
  - Form fields per design §6.3: business name and type, registered address, categories (sets which Trade Standards apply), CAC number, CAC certificate, status report or memorandum, proprietor or director ID, payout account. The registered address uses the state and city dropdowns from T-046. Documents are `KYC_DOCUMENT` files, `PRIVATE_OWNER` plus a reviewer grant. Submit returns 422 without the CAC documents.
  - On submit, jobs run the automated CAC lookup and the bank name-match (T-051); results attach as evidence and never decide.
  - Each submitted application registers as a `MERCHANT_APPLICATION` case with an evidence matrix (identity level, CAC lookup, documents present, bank name-match) and a rule-based advisory.
  - Staff endpoints, all paginated and behind `merchant.application.*` permissions: queue with filters, detail with signed document URLs (every view written to `file_access_log`), approve, request changes (named documents or fields), reject. Every decision requires a reason and a policy citation, and writes the admin action log.
  - Applicant endpoints: draft save, submit, status, resubmit after changes requested (backs SO1–SO5, BVR1 and the changes-requested state).
  - Approval is one transaction: `MERCHANT` capability `ACTIVE`, `merchant_profiles` row created with `certified_at` and storefront slug, Verified Merchant badge, `merchant.certified` published, applicant notified. Suspension or revocation publishes `merchant.certification_revoked`.
  - Granting and revoking the `MERCHANT` capability goes through identity's capability service (T-037), which owns `canActAsBuyer`.
  - Seller trust history feed (M1) and seller alerts reuse identity and notify data rather than new tables.

### T-056 — Listings lifecycle, images and stock

- **Touches:** `merchant/services/listing.service.ts`, `merchant/http/**`
- **Depends on:** T-055
- **Acceptance criteria:**
  - Listings per M5 §3.3–3.5 with images via files (`LISTING_IMAGE`, `PUBLIC`), status machine with `canTransition` and 409, append-only status log.
  - Create, edit (EL1), quick stock toggle (EL2), publish gated by the category's verification threshold, pause, remove. Listings and storefronts are available to certified merchants only (design §6.3, Q11 default); revoking certification pauses active listings.
  - Stock: optional per listing; reserved at trade funding, released on cancellation or refund, never negative (DB check) (design C18).
  - Cascades: `risk.restriction_applied` (`FULL_FREEZE`) and `verification.level_revoked` pause active listings; lifting does not auto-reactivate.
  - Report or block a seller (I4) recorded for risk and moderation.

### T-057 — Search and discovery (M19)

- **Touches:** `src/modules/search/**`, migration `search_*`
- **Depends on:** T-056
- **Acceptance criteria:**
  - `search_documents` with `tsvector` and GIN index; ranking per M19 §4 with weights in config. The reputation input defaults to the neutral 50 and updates from `reputation.score_changed` once T-102 publishes it; no code change is needed then.
  - Event-driven upserts via jobs from listing, verification and reputation events; nightly reindex reports drift.
  - Endpoints for SE1/SE2 (search), K1/K2 (categories with location filter), I1/I2 (seller profile and listings), F1/F2 (find a trade by code: returns a verified trade summary only to the parties or a valid share-link holder, rate-limited against code enumeration).
  - All results cursor-paginated.
