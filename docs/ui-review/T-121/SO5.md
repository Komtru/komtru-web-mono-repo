# SO5 — You're a verified merchant (T-121)

- **Reference:** line 5500 — Become a Seller — Mobile Web · Complete Flow ("Your Shop Is Live")
- **Built:** http://localhost:3001/account/verification/merchant/verified (inside the account frame, Verification current)
- **Code:** `apps/web-app-ui/src/sell/Live.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Reframed from "Your shop is live" to the approved outcome.** Owner correction (2026-11-19): nothing goes live. The account gains merchant status, so the heading is "You're a verified merchant".
- **Reference wording overridden: "Individual seller, upgradeable to Verified Merchant once your CAC clears".** That line describes the state before approval, and "individual seller" is the become-a-seller model. The copy names the status the account now holds: "{category} · Verified Merchant".
- **Reference's landing overridden: "lands directly on My Shop".** The screen is reached from the verification tab once the application is approved ("See your merchant status"), inside the account frame, not the Shop tab.
- **Shown only after approval.** Before it, the screen says the business is not a merchant yet and links to the verification tab, where the status is.
- **Primary action is "Go to your shop".** The reference's "Create your first listing" needs listings, which are F-041 and deferred. It links to the `/shop` placeholder until then.
- **Body adds that buyers see the badge on the Trust Passport.** The reference's Trust Passport line (M2) is the source; the line is kept short.
- **StatusHero** carries the success mark and the heading.
