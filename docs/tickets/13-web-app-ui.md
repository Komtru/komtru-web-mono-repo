# Epic 13 — `web-app-ui` (app.komtru.com, passport.komtru.com)

One app for every consumer with no buyer or seller views (design C22, §6.3), plus the Park Hub _application_ flow (design §7.6). Screen IDs refer to `docs/design-reference/SCREEN_INDEX.md` (UI Living Master v2, mapped by T-190); the numbered customer and seller tabs are `Customer-1`–`Customer-10` and `Seller-1`–`Seller-10`. The v1 index is `SCREEN_INDEX-v1.md`.

## Definition of done for every UI ticket in this epic

1. The `frontend-design` skill is invoked for each screen, not once per ticket.
2. Built only from `ui-kit` tokens, primitives and shells; no raw hex, no local copies of shared components.
3. Copy is taken from the reference, including the explanatory prose around the screen where it sets behaviour.
4. Loading, empty, error, offline and permission-denied states exist for every data-backed screen.
5. Mobile web is the baseline; desktop and tablet variants exist only where the reference shows them.
6. Tests: component tests for interactive pieces; a Playwright e2e for the ticket's happy path against the real backend; axe accessibility check with no serious violations.
7. Visual check (T-016) for every screen, saved under `docs/ui-review/<ticket>/`, with deviations listed in the ticket before it is marked done.

---

### T-110 — App scaffold and shells

- **Status:** Done (2026-10-07). Built, reviewed by a fresh whole-branch reviewer, reworked against its findings, and verified at runtime against `next start` rather than only in jsdom.
- **Review findings closed:** the passport host rewrite read `request.nextUrl.host`, which Next builds from the origin the Node server is bound to, so it never fired on any deployment and the product's front door 307'd to a sign-in route that does not exist; the rewrite also returned before the session gate, putting an authorization decision behind a client-controlled header. `/` was in neither public-path list and 404'd. The Park Agent item linked to `/hub/*` routes that did not exist. `clearOfflineCache` had no callers, so a shared handset served one person's trade list to the next under "Showing your last saved data" — and `caches.delete(CACHE)` took the precached `/offline` document with it, so fixing that leak disabled the offline screen after the first sign-out; the clear also posted to `registration.active`, null while a worker is installing, and silently reported success. An offline navigation matched with `ignoreSearch` while entries are keyed by full URL, so one query string's page answered for another. The tablet shell was app-local and is now `@komtru/ui-kit`'s `ResponsiveAppShell`, so the other four frontends inherit it instead of copying it.
- **Also fixed in `@komtru/app-kit`, and every app's bug not just this one:** `createKomtruMiddleware` built its sign-in redirect from `request.nextUrl.origin` and derived the session cookie's `Secure` flag from that origin's `http:` scheme, so behind a proxy it redirected off the public host and its `Set-Cookie` failed to overwrite the `Secure` cookie it was clearing. Both now come from `config.appUrl`.
- **Deferred review minors:** `passport.komtru.com/hub/x` resolves as a hub redirect rather than a slug (harmless, undocumented); serving `/offline`'s document for another URL leaves Next's router state pointing at `/offline` while the address bar does not, which only bites once a screen uses `next/link` instead of the current plain anchors; the navigation cache stores whatever the server sent, `Set-Cookie` included, which wants excluding before any page refreshes a session cookie; `next build` warns about two lockfiles in a worktree (`outputFileTracingRoot` unset). `next build` requires this app's own `NEXT_PUBLIC_KOMTRU_APP_URL` and `NEXT_PUBLIC_KOMTRU_API_URL`, by design and as `.env.example` instructs — the review's "fails from a clean checkout" is the convention for all five frontends, not this ticket's defect.

- **Screens:** OF1 (unchanged in v2). D9 (sidebar shell) and Y2 (role switcher) are redrawn in v2; the shell rework is T-191.
- **Depends on:** T-017
- **Acceptance criteria:** tablet shell behaviour (sidebar collapses to top nav) shared by every later tablet screen; app on port 3001 with mobile tab bar (Trades, Explore, Alerts, Messages, Account) and desktop sidebar; no role switcher and no separate seller tab bar; certified merchants see Shop in place of Explore; Account holds Payouts for anyone who has sold and a Park Agent item that opens the hub application or, once active, `park.komtru.com`; offline state via service worker; `passport.komtru.com` host rewrite to public profile routes; `/hub/*` operating URLs redirect to `park.komtru.com` (design C12).

### T-111 — Entry and authentication

- **Screens (v2):** E1, E2, E3, E4, E3b, TOS1, TOS2, AC2, AC3; social callback
- **Depends on:** T-110, T-032, T-034, T-036, T-190

### T-112 — First-time onboarding

- **Screens (v2):** OB1, OB2, OB3, OB4, OB5 (OB4 is the web push permission)
- **Depends on:** T-111, T-045, T-190

### T-113 — Home and discovery

- **Screens (v2):** AC1, Z1, SE1, SE2, F1, F2, K1, K2, Customer-1, H-01, H-02, H-03
- **Depends on:** T-110, T-057, T-060, T-190

### T-114 — Seller profile and Trust Passport

- **Screens (v2):** I1, I2, I4, Customer-6
- **Depends on:** T-113, T-102, T-190

### T-115 — Create and propose a trade

- **Screens (v2):** MI1, MI2, I3, CTS1, AC4, IF1, G3, Q1, R1, Customer-2, TC-05, TC-06
- **Depends on:** T-061, T-062, T-063, T-067, T-049, T-110, T-046, T-190
- **Notes:** G1 and Z2 open with an "I'm buying / I'm selling" choice; certified merchants skip it and are always selling. Counterparty lookup warns before send when the chosen buyer is a certified merchant.
- **Notes on location:** proposal and acceptance forms include an address picker over the user's saved addresses, with "Add a new address" inline when they have none.

### T-116 — Buyer trade core and canonical trade detail

- **Screens (v2):** Customer-3, Customer-5, CWT-01, CWT-02, CWT-03, CWT-04, CWT-05, CWT-06, CWT-07, CWT-08, CWT-09
- **Depends on:** T-115, T-065, T-110, T-190
- **Notes:** Customer-1 is one list of every trade the person is party to, as buyer or seller; each row and the trade detail show which side they are on. Seller-side actions open from the same trade detail.

### T-117 — Escrow funding

- **Screens (v2):** V1, V2, V3, AB3, AB4
- **Depends on:** T-072, T-116, T-110, T-190
- **Known deviations (pre-approved by design §5):** V1 omits the "Logistics fee" line (C7, Q5); V2 uses Paystack pay-with-transfer (C8, Q6). Fee lines and totals come from the trade's fee snapshot via the API; the app never computes them.

### T-118 — Delivery, pickup PIN and inspection

- **Screens (v2):** MI4, BEI1, BEI2, Customer-4, Z4, Z5, AB1, AB2, DE1, DE2, DE3, DE4
- **Depends on:** T-065, T-093, T-116, T-110, T-190
- **Notes:** once Park is chosen, AB1 and AB2 show the cash handling-fee notice ("Bring ₦300–₦500 cash for the park agent at pickup. This is paid to the agent, not through Komtru"), with the range read from the API.

### T-119 — Cancellation and refunds

- **Screens (v2):** CT1, CT2, AR1, CR1, CR2, CR3, SC1, SC2
- **Depends on:** T-066, T-110, T-190

### T-120 — Disputes (buyer and seller)

- **Screens (v2):** Customer-7, Customer-8, H1, H2, Y1, AC6, Seller-7, Seller-8
- **Depends on:** T-081, T-110, T-190

### T-121 — Apply for merchant certification

- **Screens (v2):** SO1, SO2, SO3, SO4, SO5, BVR1, M2
- **Depends on:** T-055, T-051, T-073, T-110, T-190
- **Notes:** SO3 changes from optional to mandatory CAC upload, and Submit stays disabled until the CAC documents are attached. SO5 "Your shop is live" appears only after operations approval; until then the applicant sees a submitted, in-review state, and a changes-requested state that reopens the named fields. Both deviate from the reference and are listed in the visual check.

### T-122 — Shop and listings

- **Screens (v2):** Seller-1, Seller-4, Seller-5, EL1, EL2
- **Depends on:** T-056, T-121, T-110, T-190
- **Notes:** Shop is a merchant-only area reached from the tab bar, not a separate view.

### T-123 — Seller trade handling and shipping

- **Screens (v2):** MI3, Seller-2, Seller-3, W1, W2, W3, BR1, SD1, X1, X2, AC8
- **Depends on:** T-115, T-064, T-087, T-093, T-110, T-190
- **Notes:** X2 lists Park first, then every enabled courier company, then "Arrange my own shipping" (m2 §10).
- **Notes on Park:** choosing Park Hub Transit on X2 shows the same cash handling-fee notice so the seller can tell the buyer. Seller-side screens Seller-2, W1–W3, BR1, SD1, Seller-3, X1, X2, MI3 and AC8 are states of the shared trade detail and list, not a seller area.
- **Notes on Park coverage:** X2 shows Park Hub Transit disabled with "Park isn't available in {city} yet" when the delivery or ships-from city has no live hub, and lists only that city's hubs when it does (design §7.8).

### T-124 — Seller payouts

- **Screens (v2):** Seller-6, AB5, AB6, WF1, PR1
- **Depends on:** T-073, T-110, T-190
- **Notes:** Payouts live under Account and are available to anyone who has sold, not only merchants.

### T-125 — Seller insights

- **Screens (v2):** AN1, DX-33
- **Depends on:** T-105, T-110, T-190

### T-126 — Trust, account and settings

- **Screens (v2):** Customer-10, Seller-10, M1, M3, J1, J2, J3, J4, LS1, NP1
- **Depends on:** T-050, T-039, T-045, T-102, T-110, T-042, T-190
- **Address book:** add, edit, archive and set a default delivery address from Account (extends J3; no separate reference screen). State and city are dropdowns fed by the geo APIs; the city list reloads when the state changes; "My city isn't listed" submits a city request and explains it will be reviewed.

### T-127 — Reviews

- **Screens (v2):** AC5, SR1, SR2
- **Depends on:** T-102, T-110, T-190

### T-128 — Messaging

- **Screens (v2):** Customer-9, Seller-9, AC7, MC1
- **Depends on:** T-108, T-110, T-190

### T-129 — Help and support

- **Screens (v2):** L1, SP-M06, SP-M07, SP-M08, SP-M09, plus ticket create, list and detail (built in the same design language; visual check is design-system conformance)
- **Depends on:** T-100, T-110, T-190

### T-130 — Park Hub application

- **Screens (v2):** PH1, PH2, PH3, PH4, PH5, PH6, PA7, PA8
- **Notes:** the Account item shows the states "Not yet set up", application in review, and active. PH4 deviates from the reference: no payout setup, only an acknowledgement that agents collect the ₦300–₦500 handling fee from buyers in cash (design C23).
- **Depends on:** T-091, T-110, T-046, T-190
- **Notes on location:** PH1 uses the same state and city dropdowns; a missing city goes through the city-request flow, never free-text matching.

### T-131 — Wallet top-up

- **Status:** Blocked on design §12 Q3
- **Screens (v2):** AB7, SP-M10
- **Depends on:** T-077, T-110, T-117, T-190
- **Default if unanswered:** screen implemented behind a disabled flag; the "Komtru Wallet" payment option in V1 hidden while the flag is off.
