# SO3 — Business verification (T-121)

- **Reference:** line 5456 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/account/verification/merchant/verify-business
- **Code:** `apps/web-app-ui/src/sell/VerifyBusiness.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Reference wording overridden: "optional", "skip" and "you can list and trade today".** The reference's headline says the step is optional, its upload says "Optional — skip and sell as an individual seller for now", and its info line says "You can list and trade today without this". Owner correction (2026-11-19): an unverified default seller is capped on how much it can transact until it is a merchant. Those lines would contradict the cap, so none are drawn. The step is merchant verification, and the lead paragraph says that verifying makes the business a merchant and that until then the amount transacted is limited.
- **Lead paragraph added** (the copy above). The reference has no such line.
- **Frame title "Verification" becomes "Business verification"**, the reference's step name.
- **CAC number and CAC certificate are mandatory.** Per T-121, Submit needs the CAC documents, so the skip is removed.
- **Two more documents required.** A status report or memorandum and the proprietor or director ID are drawn as upload slots; the backend requires both before submit.
- **Primary action renamed.** "Submit for verification" becomes "Continue to payout account", because the application is sent on the payout step (submit needs the payout account).
- **Info banner rewritten.** The reference says the upload is optional; the build says all three are required.
- **Upload areas use the ui-kit `FileDropzone`**, two-slot grid with thumbnails, not the reference's `.m-upload` strip.
- **Uploading and failure states** shown per slot; a file that does not upload is said so and nothing is saved.
- **Replace, not remove.** A document is replaced by uploading another; there is no remove control. The draft save upserts the types it is sent and never removes one left out, and the backend has no delete for an applicant's document, so a removal would come back on reload.
- **Business type** is sent as registered business, because a CAC number is required.
