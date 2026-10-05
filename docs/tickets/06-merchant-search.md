# Epic 06 — Merchant management and discovery (M5, M19)

---

### T-055 — Merchant profiles and seller onboarding

- **Touches:** `src/modules/merchant/**`, migration `merchant_*`
- **Depends on:** T-050, T-049, T-040
- **Acceptance criteria:**
  - `merchant_profiles` per M5 §3.2 plus selected categories (SO2) and storefront slug.
  - Seller onboarding API backing SO1–SO5: business basics (identity already verified from the buyer side), categories (sets which Trade Standards apply), optional business verification (hands off to T-051), payout account (hands off to T-073), activation of the `SELLER` capability when M1/M6 gates pass.
  - Seller trust history feed (M1) and seller alerts reuse identity and notify data rather than new tables.

### T-056 — Listings lifecycle, images and stock

- **Touches:** `merchant/services/listing.service.ts`, `merchant/http/**`
- **Depends on:** T-055
- **Acceptance criteria:**
  - Listings per M5 §3.3–3.5 with images via files (`LISTING_IMAGE`, `PUBLIC`), status machine with `canTransition` and 409, append-only status log.
  - Create, edit (EL1), quick stock toggle (EL2), publish gated by the category's verification threshold, pause, remove.
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
