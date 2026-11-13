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
- **Acceptance criteria:** tablet shell behaviour (sidebar collapses to top nav) shared by every later tablet screen; app on port 3001 with the v2 shells (superseded by T-191: five destinations per Buy/Sell mode, Discover rather than Explore, Alerts as the bell); no separate seller tab bar; certified merchants are held in Sell mode; Account holds Payouts for anyone who has sold and a Park Agent item that opens the hub application or, once active, `park.komtru.com`; offline state via service worker; `passport.komtru.com` host rewrite to public profile routes; `/hub/*` operating URLs redirect to `park.komtru.com` (design C12).

### T-111 — Entry and authentication

- **Status:** Done (2026-11-09). Built without social sign-in by owner decision (below). Verified against the real backend in the running app: sign-up through E3b to a session and the first password, log-in with a wrong and a right password, the session gate, and a full password reset. Reviewed by a fresh whole-branch reviewer (Opus): 4 must-fix and 10 should-fix items; all must-fix and 8 should-fix fixed. Visual check: `docs/ui-review/T-111/`.
- **Review findings closed:** `next` could redirect off-site after sign-in (`/\t/evil.com` passes prefix checks and the URL parser strips the tab), so `safeNext` now parses and requires the same origin. OTP autofill into a row with a digit already typed produced a corrupted code. Coming back from E3 to TOS1 opened a second account and sent a second SMS. TOS1 sent whatever Terms version was current at submit rather than the one on screen. A used-up second factor read as "wrong code" forever. AC3 dead-ended once the reset token expired. Validation failures were drawn but not announced. A one-hour rate limit read as "3600 seconds". The backend route did not typecheck.
- **Also fixed in shared packages:** `@komtru/ui-kit` `OtpInput` dropped digits under fast typing and truncated SMS autofill and keyboard code suggestions to one digit (`maxLength={1}`); `Button asChild` links now centre their label. `@komtru/app-kit` gains the `/api/auth/verify` handler; `@komtru/api-client` the entry endpoints; the backend a public `GET /auth/terms`.
- **Deviations:** E2's button is "Continue", because TOS1 has to come before the account exists and the account and code come from one call. Passwords need 10 characters (backend policy), not the reference's 8. E4 accepts a phone number, email or username, with the reference's phone label and a helper line. The second factor continues on E4 with E3's cells (no reference screen); passkeys are not offered. Suspended, locked and closed accounts get an inline notice; AS1/AS2 are T-205. TOS1's boxes start unticked. TOS2 lists "What changed" rows only for a version whose changes are recorded in `src/entry/terms-copy.ts`. The phone path's first password (`/set-password`) has no reference screen.
- **Not done, and why:** no Playwright e2e — the repo has no app e2e harness yet (only `tools/visual-check`), so the happy path is held by component tests against a faked network plus the manual run above. TOS1, E3/E3b, AC3 and TOS2 have no visual-check shots: they need in-flow state the harness cannot set.
- **Deferred review items:** `/set-password` and `/terms-updated` are client redirects after sign-in, so a person who opens `/home` directly skips them; enforcing either belongs in the shell or the backend, and the first-time onboarding chain is T-112's. `next` is not carried through sign-up or password reset, only through log-in. `OtpInput` re-syncs its internal value only when the parent's value changes, so a parent that refuses an edit by keeping the same value leaves a stale base for the next keystroke.

- **Screens (v2):** E1, E2, E3, E4, E3b, TOS1, TOS2, AC2, AC3; social callback (moved to T-034, below)
- **Depends on:** T-110, T-032, T-036, T-190
- **Owner decision (2026-11-09):** build T-111 without social sign-in rather than wait for T-034. The
  social buttons and the OAuth callback screen belong to T-034, which adds them to E1, E2 and E4 when
  it lands.
- **Follow-on (2026-11-09):** E2 now also asks for an email address, required, stored as the account's
  unverified second channel. Outside production, when no SMS can really go out — `NOTIFY_SMS_DRY_RUN`
  or no Termii credentials — a registration or phone-reset code is emailed as well as queued for SMS,
  and E3 names the inbox it went to. The challenge stays a phone challenge, so entering the code
  still proves the phone. Production is unchanged: a missing SMS provider still dead-letters rather
  than verify a number from an inbox. `nextStep` now puts the second channel's verification after the
  password and username, so a phone sign-up that gave an email is still asked to set a password.

### T-112 — First-time onboarding

- **Screens (v2):** OB1, OB2, OB3, OB4, OB5 (OB4 is the web push permission)
- **Depends on:** T-111, T-045, T-190
- **Status:** Done (2026-11-11). Plan: `docs/superpowers/plans/2026-11-11-f-013-onboarding.md`. Review: 8 items fixed (no must-fix; the `next/link` item was declined because the app uses plain anchors, per T-110). OB4 asks permission but registers no device until a web push token source exists (owner question). Visual check: `docs/ui-review/T-112/`. Frontend only: `@komtru/api-client` gains `registerDevice` (`POST /me/devices`) and `useRegisterDevice`.
- **Behaviour:** `/welcome/1`, `/2`, `/3`, `/notifications`, `/done`. A new sign-up is sent there from E3 (terms and the first password still come first); log-in never is. Skip leaves at any screen; finishing or skipping is remembered on the device and the screens then redirect to `/`; a new sign-up clears the mark. OB5 is reachable only through OB4 in the same tab (a deep link goes to the app), and the sign-up first name is read once and dropped. Allow notifications asks the browser; nothing blocks the way on (Not now, a refusal, no browser support, a failed registration).
- **Open for the owner:** the platform sends push through FCM, so a browser needs a Firebase web token and none is wired (no Firebase web config, SDK or messaging worker in the repo): OB4 asks for permission and registers the device only once a token source exists. Whether returning users on a new device should see the walkthrough (built: no). Whether Skip should also skip the notification ask (built: yes). A replay link in Account is not drawn and not built.

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
- **Status:** Done (2026-11-09). Plan: `docs/superpowers/plans/2026-11-09-f-017-propose.md`. Shipped as feature **F-017**, the project's first feature built end to end. Review: 6 must-fix and 16 should-fix, all closed. Nine v2 screens (I3, CTS1, IF1, G3, Q1, R1, Customer-2, TC-05, TC-06) plus the invite and claim-by-code flows, which v2 does not draw. **Three defects the green suite hid**, all found in review: the invited party had no in-app route to the trade at all and the copy told people to open a link nothing sends; claiming an invitation was a dead end because the backend requires an address and the screen offered no way to add one (its test was named "sends the person to add an address" and asserted only that the sentence appeared); and editing after a failed send resubmitted the **original** draft, so changing a price and retrying sent the old one. **Backend added here**, because a feature owns both layers: `standardVersionId` on the trade view, and `counterparty` on `GET /trades/:id` and the action responses. The first closes a time bomb — the pinned standard was addressable only by version _number_, so publishing a new standard would have silently dropped every in-flight trade's proof requirement to one photo, testing clean and failing later in production; a test now freezes a trade on v3, publishes v4 and asserts v3 still governs. The second removes a party strip that worked only for a user's 20 most recent trades. The implementer also found its own earlier proof rule wrong: `minPhotos: 0` does not mean no media, because `checkProofMedia` keeps the bar at one unless a video stands in. **Deleted:** the device-local trade list stopgap, which had leaked trade ids between users on a shared phone. **Tooling:** the visual-check harness was reading the **v1** master, so v2 line numbers pointed at unrelated screens and three of these nine do not exist in v1; it now defaults to v2 and takes `--content <selector>` so shots align with the reference instead of sitting 54px low. `KomtruProviders` never provided `ApiClientProvider`, so `useAddresses` and `useStates` would have thrown in the real app. **ui-kit gained** the trade vocabulary later features reuse: ItemCard, PartyStrip, TermList/TermRow, CounterDiffRow, StandardCard, StatusHero, CodeCard, VersionTimeline, OptionCard, ScreenHeader and the shared banners. **Deviations, recorded in `docs/ui-review/T-115/`:** IMEI (MI1, MI2) and risk-hold uploads are post-MVP F-020/F-021, so G3 and IF1 deliberately show less; IF1 is the rejected-proposal state in IF1's layout, not the IMEI screen; I3 is a typed-item form because listings are F-041; the counter endpoint takes no note, so TC-05's "Reason / Note" is absent; the "342 trades" strip line is Trust Passport data deferred to F-016. **Open for the owner:** should a held `UNDER_PROPOSAL_REVIEW` proposal claim the initiator's attention? Q1 draws it highlighted but the server returns `attention: null`, and the rule lives on the server. Also whether CTS1's clock-starts, buyer-can-request, full-refund-if and cancellation rows should be platform data or fixed policy copy.

### T-116 — Buyer trade core and canonical trade detail

- **Screens (v2):** Customer-3, Customer-5, CWT-01, CWT-02, CWT-03, CWT-04, CWT-05, CWT-06, CWT-07, CWT-08, CWT-09
- **Depends on:** T-115, T-065, T-110, T-190
- **Notes:** Customer-1 is one list of every trade the person is party to, as buyer or seller; each row and the trade detail show which side they are on. Seller-side actions open from the same trade detail.
- **Status:** Done (2026-11-10). Plan: `docs/superpowers/plans/2026-11-09-f-022-workspace.md`. Shipped as the UI half of feature **F-022**, which is now closed end to end. Review: 5 must-fix and 9 should-fix, all closed. Eleven v2 screens: CWT-01–CWT-09 as **one role-aware tabbed surface** (not six screens) plus Customer-3 and Customer-5. `TradeScreen` was extended, not forked — F-017's pre-acceptance states are byte-identical and `PENDING_PAYMENT` onward routes to `Workspace`. New `GET /trades/:id/activity`, built here because none existed. **The review's big find was a privacy hole that was not read-only:** `requireParty` gated on membership with no status check, so a bound counterparty could read a held `UNDER_PROPOSAL_REVIEW` proposal — including the proposer's street, recipient and phone — through `GET /trades/:id`, by-code, decline and the room, while the list and activity feed hid it; and because `CANCEL` is legal from that state with no guard, they could **cancel a proposal TrustOps was still reviewing**. The two copies of `HIDDEN_FROM_COUNTERPARTY` had already drifted. It is now one gate, `domain/visibility.ts` (`canSeeTrade`, `isHiddenFromCounterparty`, `pushDisposition`), used by `requireParty`, by-code, the list SQL, the activity feed, the room authoriser and the push subscriber; removing it fails 10 of 14 targeted tests. `previousStatus` and `action` became optional on the wire so a cleared review cannot announce that a review happened. **Realtime did not work in the case it exists for, for two independent reasons:** the socket died on an idle screen (fixed handshake token, lazy HTTP refresh, no `auth:refresh` handler, so the gateway revoked it after ~10 minutes and every reconnect sent a stale token — `auth` is now a callback and `auth:refresh` is handled); and a 60-second clock-skew rule silently dropped every push on a fast device, with a comment claiming a periodic refetch bounded it when none existed and focus refetch is off app-wide. The rule is gone and the contract is tested against clocks ten minutes fast, ten minutes slow and a day fast, with a 30-second poll as the real fallback when disconnected or refused. `useTradeLive` now mounts for **every** status, so a waiting proposer sees acceptance — previously the one transition they most needed was the one they could not see. **`web-app-ui` never passed a socket token at all**, so no socket would ever have connected while every realtime test passed; `Providers` now sets `socketFollowsSession` and a test pins it. `Workspace.tsx` (773 lines) was split into `workspace/` with per-status files and a typed tab registry, since F-024, F-026, F-027, F-028, F-029, F-031 and F-032 all extend it. A new contract test parses stand-in responses with the real shared-types schemas and **immediately caught two already-drifted F-017 fixtures**. **Seams (no dead buttons):** funding F-024, shipping F-026, inspection F-027, disputes F-032, reviews F-038. **No API for:** courier tracking, payment/expiry deadline, dispute case and stage, delivery method and fee — drawn as seams rather than invented. **Open for the owner:** should CWT-01 show the drawn "Protect the agreed amount" banner rather than TC-06's ring; should Customer-5 drop the summary card and tabs for a full-screen moment; should the Money rows read the ledger (F-024) rather than infer "held" from status; and are rooms never being left acceptable, given the gateway cleans up on disconnect.

### T-117 — Escrow funding

- **Screens (v2):** V1, V2, V3, AB3, AB4
- **Depends on:** T-072, T-116, T-110, T-190
- **Known deviations (pre-approved by design §5):** V1 omits the "Logistics fee" line (C7, Q5); V2 uses Paystack pay-with-transfer (C8, Q6). Fee lines and totals come from the trade's fee snapshot via the API; the app never computes them.
- **Status:** Done (2026-11-10). Plan: `docs/superpowers/plans/2026-11-10-f-024-fund-escrow.md`. Review: 13 items fixed. Also added the backend `fundTrade` subscriber (PENDING_PAYMENT → FUNDED on `ledger.payment.escrow_funded`), with late, unknown or mismatched funding held for review via `trades.funding.review_required`. Visual-check deviations in `docs/ui-review/T-117/`.

### T-118 — Delivery, pickup PIN and inspection

- **Screens (v2):** MI4, BEI1, BEI2, Customer-4, Z4, Z5, AB1, AB2, DE1, DE2, DE3, DE4
- **Depends on:** T-065, T-093, T-116, T-110, T-190
- **Notes:** once Park is chosen, AB1 and AB2 show the cash handling-fee notice ("Bring ₦300–₦500 cash for the park agent at pickup. This is paid to the agent, not through Komtru"), with the range read from the API.
- **Status:** Done for MVP scope (2026-11-11); AB2 (Park) and MI4 (multi-item, F-080) deferred. Plan: `docs/superpowers/plans/2026-11-11-f-027-deliver-inspect.md`. Review: 8 items fixed. Built: Inspect & Confirm at `/trade/[id]/inspect` (Customer-4, Z4: the seller's proof as signed-URL photos beside the delivery evidence; Z5: confirm and release behind an acknowledgement checkbox, nothing sent until it is ticked), BEI1 (buyer asks for more inspection time, once, in hours up to one original window) and BEI2 (seller accepts or declines, on the same screen), confirm delivery on the trade overview (AB1 live-logistics card with waybill and plate), DE1 at `/trade/[id]/extend`, DE2 and DE3 on the paid overview. api-client gained the confirm-delivery, accept-inspection, both extension flows and `GET /files/:id`. No backend change, no migration. Left out for MVP: AB2 and the Park fee notice (Park, F-062), MI4 (multi-item, F-080), "Report an issue" (F-032), DE3's refund button (F-030; the platform refunds on its own, DE4 is the existing refunded outcome). **Defaults applied, owner to confirm:** BEI1 as the platform built it is an ask made during inspection (not "with my proposal" as the reference draws it) with 12 h, 24 h and one-window choices; BEI2 has no counter, only accept and decline; the release amount in Z5 is the item amount. Visual check: `docs/ui-review/T-118/`. Also fixed: bottom sheets sat under the tab bar on a phone (`OverTabBar`).

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
- **Status:** Done (2026-11-11). Plan: `docs/superpowers/plans/2026-11-11-f-026-seller-fulfilment.md`. Review: 9 items fixed. Built: ship screen (Seller-3/X2 self-arranged: waybill, receipt photo, driver phone, plate, client-validated to the backend rules), X1 dispatch lock by status, Report delivery on the shipped state, AC8 Active Orders on `/orders`. Seller-2/W1–W3/BR1/SD1 were already built by F-017. Left out for MVP: MI3 (multi-item, F-080), Park and courier branches of X2 (F-062/F-066). Visual check: `docs/ui-review/T-123/`. The web phone check is lenient (backend uses libphonenumber).

### T-124 — Seller payouts

- **Screens (v2):** Seller-6, AB5, AB6, WF1, PR1
- **Depends on:** T-073, T-110, T-190
- **Notes:** Payouts live under Account and are available to anyone who has sold, not only merchants.
- **Status:** Done (2026-11-11). Plan: `docs/superpowers/plans/2026-11-11-f-037-payouts-ui.md`. Review: 10 items fixed (2 must-fix: the withdraw idempotency key is kept across ambiguous 408/409/5xx failures and background refetches). Screens Seller-6, AB5, AB6, WF1, PR1 under `/account/payouts`. The Account Payouts row shows only when `viewer.hasSold`. The viewer seam was filled on 2026-11-13 (plan `docs/superpowers/plans/2026-11-13-f-037-viewer-seam.md`, review: 1 must-fix and 5 should-fix items fixed): `GET /me/viewer` facts are sealed into the `komtru_session` hint at sign-in and refresh.

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
