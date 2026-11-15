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
- **Status note (2026-11-15, merged):** built except as listed. **Not marked done: one criterion is unmet and needs the owner's sign-off.**
  - **Unmet: "jobs run the bank name-match".** The CAC lookup is requested at submit (a job that re-checks while it is pending). The bank name-match is not triggered: it needs (a) the plaintext account number, which `ledger.payout_accounts` holds only encrypted and M8 owns, so the merchant module would have to decrypt another module's secret or the ledger would have to export a reader for it, and (b) T-051 refuses the match until the CAC check has passed, and trust publishes nothing when a CAC check passes, so something in trust would have to call back into merchant. Each is a cross-module change, so neither was invented here. Today the evidence matrix reads the verdict already on the applicant's payout account (`name_match_result`, written by T-073 from the applicant's own BVR1 flow) and shows "not run" when there is none. Decision needed: add a ledger reader and a trust completion event, or accept the applicant-driven match as the contract.
  - **Suspension and revocation have no caller.** `endCertification` publishes `merchant.profile.certification_revoked` and is tested, but nothing in production calls it and the ticket lists no staff route for it. It is a seam owned by risk or trust (a staff decision with its own reason and permission). Until that exists, an ended certification cannot be re-applied for through the queue (`assertCanApply`, and approval refuses an account that already has a profile).
  - **Signed document links are bearer links.** They last `signedUrlTtlSeconds` (300 by default) and anyone holding one can fetch the bytes until then, with no further `file_access_log` row. The console draws a document inline when a reviewer presses View (one logged view each) and offers no link to open elsewhere; the limitation remains for anyone who reads the network response.
  - **KYC reviewer grants are narrow.** Made only by `grantKycReviewerAccess` (not reachable from `POST /admin/files/:id/grants`, which refuses anything but a `PRIVATE_CASE` file), only for files attached to an application and roles holding `merchant.application.view`, and revoked in the decision transaction.

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
