# F-028 closing: Evidence — Submit (CWT-S13) and the evidence seam it needs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** a party attaches an uploaded file to a trade under an event category, and both parties read a trade's media
by category, so CWT-S13 becomes the reference's form and CWT-S12's Delivery and Inspection groups fill in.

**Owner decision (2026-11-17):** upload first through the existing files endpoint, then attach the file id.
Client: `POST /files/upload-url` -> Cloudinary -> `POST /files/:id/finalize` -> **new** `POST /trades/:id/evidence`.

## Backend design

- **Sibling table `trade.trade_evidence_media`, not a column on `trade_proof_media`.** `trade_proof_media` _is_ the
  seller's pre-agreement proof: `proofFileIds`, `assertSellerProof`, the proof count on the trade view, the Z4
  `sellerProof` read, the grant and revoke around send/accept/decline, and the "file used elsewhere" checks all select
  every row of a trade. A category column would force a filter into each of those (and a missed one would count a
  delivery photo toward the proof gate or revoke it on a decline). A sibling leaves every existing reader untouched.
  Columns: `id`, `trade_id` (cascade), `file_id`, `event` (enum `DISPATCH | DELIVERY | INSPECTION | ISSUE`, the
  reference's four S13 categories; Listing is the seller's proof and stays in `trade_proof_media`),
  `attached_by_user_id`, `attached_by_role` (BUYER | SELLER, fixed at attach time), `created_at`.
  Unique on `file_id` (a file is evidence once, anywhere), index on `(trade_id, event, created_at)`.
  Insert/select only for `komtru_app`: evidence is never edited or deleted by the app (tombstoning is files' job).
- **Routes** (`trades/http/evidence.routes.ts`, scope `CONSUMER`, parties only through `loadTrade` + `requireParty`,
  the one door every other trade route uses, so a stranger and a held trade both read as 404):
  - `POST /trades/:id/evidence` body `{ event, fileIds: uuid[1..10] }`, 201, `retryable: true`, rate limited like the other
    actions. Replay by the same party is a no-op returning the rows.
  - `GET /trades/:id/evidence?event=` cursor-paginated, `{ items: [{ id, fileId, event, attachedByRole, attachedAt }], nextCursor }`.
- **Rules.** Trade must be SHIPPED, UNCONFIRMED_DELIVERY, INSPECTION or DISPUTED (409 otherwise): evidence supports a live
  trade, and a closed one's record does not change. Role per event: DISPATCH seller, INSPECTION buyer, DELIVERY and
  ISSUE either (403 otherwise). At most 20 files per event per trade. A file must be the caller's own READY, ACTIVE,
  `PRIVATE_CASE` upload, granted to nobody, and not already proof, a waybill receipt or evidence elsewhere. A file still
  uploading is a 409 `FILE_PROCESSING` so the client can wait and retry; anything else unusable is a 422.
- **Grants.** After commit, grant the counterparty read access (`grantAccess`, reason `Trade <code> evidence`), the
  `grantProofToBuyer` pattern: idempotent, run again on a replay so a failed grant heals. The seller's proof stays
  buyer-only-after-send; the waybill receipt stays seller-only (unchanged).

## Frontend

- api-client: `attachEvidence`, `listEvidence` endpoints, `useTradeEvidence(id, event, enabled)` and `useAttachEvidence`.
- S12 `Trail`: Delivery and Inspection groups read the new list (own states: loading, empty, error with retry);
  an Issue group appears only if it has files. Existing Listing and Dispatch groups unchanged.
- S13 `AddEvidence`: category radio list limited to the caller's allowed events, file picker using `uploadFile` and the
  existing media checks, thumbnails, Submit disabled until a category and a file exist, waits through FILE_PROCESSING,
  states: loading, error, offline, not-in-an-open-status, success -> back to S12.

## Tasks

- [ ] schema + migration 0051 + schema test
- [ ] evidence service tests (int) then service, ports, routes, module wiring, route test
- [ ] shared contract: api-client endpoints + hooks (+ contract test)
- [ ] S12 groups, S13 form (jsdom + axe tests first)
- [ ] ui-review CWT-S12 / S13 notes, FEATURE_MAP / ticket notes
- [ ] full verification, `git merge-tree` against `main`
