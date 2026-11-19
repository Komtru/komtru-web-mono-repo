# SO3 — Business Verification (T-121)

- **Reference:** line 5456 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/sell/verify-business
- **Code:** `apps/web-app-ui/src/sell/VerifyBusiness.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **CAC certificate is mandatory.** The reference's upload is optional with a skip. Per T-121, Submit needs the CAC documents, so the skip is removed.
- **Two more documents required.** A status report or memorandum and the proprietor or director ID are drawn as upload slots; the backend requires both before submit.
- **Primary action renamed.** "Submit for verification" becomes "Continue to payout account", because the application is sent on the payout step (submit needs the payout account).
- **Info banner rewritten.** The reference says the upload is optional; the build says all three are required.
- **Upload areas use the ui-kit `FileDropzone`**, two-slot grid with thumbnails, not the reference's `.m-upload` strip.
- **Uploading and failure states** shown per slot; a file that does not upload is said so and nothing is saved.
- **Business type** is sent as registered business, because a CAC number is required.
