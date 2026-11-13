# F-028 Delivery and evidence in the workspace (T-195) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** the six supporting screens CWT-S08 to CWT-S13 behind the tabbed trade workspace, self-arranged path only.

**Architecture:** one new directory `apps/web-app-ui/src/trade/delivery/`, one static route per screen under
`app/(app)/trade/[id]/` (static segments beat `[tab]`). Every screen reads the trade with `useTrade` and, where it
needs the shipment, `useInspection` and `useDeliveryDeadline`. No backend change, no migration, no new api-client hook.

**Tech Stack:** Next.js, `@komtru/ui-kit`, `@komtru/api-client/react`, vitest + testing-library + axe.

**Spec:** `docs/design-reference/Komtru — UI Living Master v2.html` lines 10990-11110; `SCREEN_INDEX.md` rows CWT-S08..S13;
T-195, T-118 and T-123 notes in `docs/tickets/13-web-app-ui.md`.

## Global Constraints

- ui-kit tokens and primitives only; no raw hex; plain anchors, never `next/link`.
- Park (F-062 / T-093) is out of the MVP: no hub custody, no release PIN, no cash-handling notice.
- Every data-backed screen: loading, empty, error, offline (shell banner plus offline wording on a failed read), permission-denied.
- Shared files (`workspace-state.ts`, `workspace/states/Funding.tsx`) change in one contiguous, additive place.
- Playwright e2e waived (no harness; T-192/T-193 precedent). Happy paths are jsdom tests against a mocked api-client.

## Review Focus

- A buyer opening the seller-only dispatch screens is refused in words, with no controls.
- A trade not yet funded shows the dispatch lock, never the ready banner.
- A read of the shipment that fails is said plainly and retryable, not drawn as "no files".
- A trade whose media cannot be read per event shows empty groups honestly, never invented counts.
- Double press on "Confirm handover" sends one ship call.

## Backend gaps found (reported, not invented)

- **No endpoint attaches evidence to a trade record or case** and none lists trade media by event. The platform
  exposes only: seller proof media (`sellerProof.media`) and the waybill receipt (`deliveryEvidence.selfArranged.receiptFileId`)
  on `GET /trades/:id/inspection`. So CWT-S12 shows Listing and Dispatch from those and an honest empty Delivery and
  Inspection; CWT-S13 is drawn as a seam (no Submit button) until a backend ticket adds the attach endpoint.
- No courier tracking API: CWT-S10 shows what is recorded (waybill, handover time, plate, delivery deadline).

## Tasks

### Task 1: shared frame, hrefs, routes

- Create `src/trade/delivery/parts.tsx` (`DeliveryFrame`, `useSideGate`), `src/trade/delivery/page.tsx` (server route helper).
- Modify `workspace-state.ts`: add `dispatchHref`, `waybillHref`, `trackHref`, `pickupHref`, `evidenceHref`, `addEvidenceHref`; `shipHref` points at dispatch; add Track and Evidence action rows.
- [ ] Tests first in `test/delivery-screens.test.tsx` and `test/workspace-state.test.ts`; commit.

### Task 2: CWT-S08 Dispatch readiness (`Dispatch.tsx`)

- Seller only; FUNDED shows ready banner, dispatch terms, checklist (checkboxes), "Add waybill details" to S09, "View agreement"; before funding the X1 lock; after shipping, a link to tracking.
- [ ] Test, implement, commit.

### Task 3: CWT-S09 Waybill and handover (`Handover.tsx`)

- Self-arranged form (waybill, receipt photo, driver phone, plate) plus the handover confirmation; "Confirm handover" calls `useShipSelfArranged`. Reuses `ReceiptPicker` (now exported) and `shipping/evidence.ts` checks.
- [ ] Test, implement, commit.

### Task 4: CWT-S10 Tracking and custody (`Track.tsx`) and CWT-S11 Pickup (`Pickup.tsx`)

- Track: logistics card + custody timeline Seller, Courier, You. Pickup: self-arranged delivery details, no PIN.
- [ ] Test, implement, commit.

### Task 5: CWT-S12 Trade media (`Evidence.tsx`) and CWT-S13 Add evidence (`AddEvidence.tsx`)

- [ ] Test, implement, commit.

### Task 6: visual check, deviations, verification

- [ ] `docs/ui-review/T-195/`; packages build; turbo lint typecheck test; prettier; commit.
