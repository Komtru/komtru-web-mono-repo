# SO4 — Where should we send payouts? (T-121)

- **Reference:** line 5480 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/account/verification/merchant/payout
- **Code:** `apps/web-app-ui/src/sell/Payout.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Frame title "Payout Account"** is kept, and the reference's "Become a Seller" frame title is dropped (owner correction, see SO1). The reference's copy is otherwise kept.
- **Verified accounts become a choice.** When the business already has a verified account, the bank and number fields give way to a list of verified accounts with the bank-resolved name. The reference draws only the form.
- **Save button added.** "Save payout account" sits under the form; the reference has one action, which here confirms the choice.
- **Confirm also sends the application.** "Confirm payout account" saves the choice and submits the application, or resubmits when staff asked for changes.
- **Checking state.** While the bank checks a new account the form is replaced by a "Checking with your bank" note, not drawn in the reference.
- **Name-match not enforced in the UI.** The reference's info banner (kept verbatim) says the account must match the verified name. The payout-account contract exposes the bank's name but no match verdict, so the screen cannot show or enforce the match. Still open: see the report's bank name-match note. The resolved account name is shown, nothing is compared.
- **Failure shown above the form** with the bank's reason.
