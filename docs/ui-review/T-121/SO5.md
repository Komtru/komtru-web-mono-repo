# SO5 — Your Shop Is Live (T-121)

- **Reference:** line 5500 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/sell/live (inside the app shell, Shop tab)
- **Code:** `apps/web-app-ui/src/sell/Live.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Shown only after approval.** T-121 puts this screen after operations approval. Before it, the screen says the shop is not live yet and links to the verification status.
- **Copy names the merchant status.** "Electronics · Verified Merchant" replaces the reference's "Individual seller, upgradeable to Verified Merchant once your CAC clears", which describes the state before approval.
- **Primary action is "Go to your shop".** The reference's "Create your first listing" needs listings, which are F-041 and deferred. It links to the `/shop` placeholder until then.
- **StatusHero** carries the success mark and the heading.
