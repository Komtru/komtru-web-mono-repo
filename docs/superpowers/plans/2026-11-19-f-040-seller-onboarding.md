# F-040 / T-121: Become a Seller and business verification (UI)

Scope: the merchant-facing screens of T-121 in `apps/web-app-ui`. SO1–SO5, BVR1 and M2. The backend (T-055, T-051)
and the operations-app review (T-154) are already merged and are not touched.

## Contract the screens build against

- Applicant endpoints in `packages/api-client/src/merchant.ts`: `GET/PUT /merchant/applications/me`, `POST
/merchant/applications/:id/submit`, `POST /merchant/applications/:id/resubmit`.
- `GET /me/payout-accounts` and `POST /me/payout-accounts` (202, PENDING until the bank decides), `GET /banks`.
- `GET /config/trade-standards` for the category tiles (inspection window comes from the data).
- Files: `uploadFile` as `KYC_DOCUMENT` / `PRIVATE_OWNER`, the same as VF1.
- Submit needs every field and the CAC certificate, a status report or memorandum, and the director ID. Submit
  is refused (422) otherwise, so the flow must collect all of them.
- A REJECTED application is terminal. `GET /me` returns the live application, or else the latest one, so a new
  draft (a PUT) starts a fresh application after a rejection.
- Resubmit is only valid from CHANGES_REQUESTED.

## Routes

| Route                   | Screen                                                  | Shell                 |
| ----------------------- | ------------------------------------------------------- | --------------------- |
| `/sell/start`           | SO1                                                     | none (flow frame)     |
| `/sell/category`        | SO2                                                     | none                  |
| `/sell/verify-business` | SO3                                                     | none                  |
| `/sell/payout`          | SO4                                                     | none                  |
| `/sell/live`            | SO5                                                     | AppShell, tab shop    |
| `/shop/verification`    | M2 / BVR1 / in-review / changes-requested / not started | AppShell, tab account |

`/shop` itself (T-122, F-041 deferred) is not touched.

## Steps

1. api-client: `react/merchant.ts` with `useMyMerchantApplication`, `useSaveMerchantDraft`,
   `useSubmitMerchantApplication`, `useResubmitMerchantApplication`. Export from `react/index.ts`. Build `dist`.
2. `src/sell/draft.ts`: pure rules. Step ordering, which status shows which screen, draft body from form values,
   the "ready to submit" check, changes-requested labels. Test first.
3. Per screen, test first then build (frontend-design skill invoked per screen):
   SO1, SO2, SO3, SO4 (confirm = add or pick a payout account, save the draft, then submit or resubmit), SO5,
   then M2/BVR1 with its states.
4. Route pages under `app/(app)/sell/*` and `app/(app)/shop/verification`.
5. Commit after each green step. Visual check per screen into `docs/ui-review/T-121/`.
6. Verify with turbo lint/typecheck/test and prettier.

## Deviations from the reference (to record in `docs/ui-review/T-121/`)

- SO1: adds a registered address, state and city (the backend requires them). The phone field is not drawn: the
  application has no phone field, so it would not save.
- SO3: CAC number and CAC certificate are mandatory (T-121 note). Adds status report or memorandum and director ID
  (the backend requires them). "Skip for now" is removed. The primary action is "Continue to payout account",
  because submit needs the payout account, which comes on SO4.
- SO4: "Confirm payout account" also submits the application (or resubmits after changes were requested).
- SO5: shown only after approval. Copy says "Verified Merchant", not "Individual seller, upgradeable once your CAC
  clears". Primary action goes to `/shop` (the placeholder until F-041).
- M2/BVR1: "Resubmit CAC details" starts a new draft (REJECTED is terminal). Status rows come from the application
  and the payout accounts.
