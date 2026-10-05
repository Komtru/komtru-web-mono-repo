# Epic 13 — `web-app-ui` (app.komtru.com, passport.komtru.com)

One app for every consumer with no buyer or seller views (design C22, §6.3), plus the Park Hub *application* flow (design §7.6). Screen IDs refer to `docs/design-reference/SCREEN_INDEX.md`; customer tabs 1–10 are C1–C10 and seller tabs 1–10 are S1–S10, as the reference's own prose names them.

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
- **Screens:** OF1, D9, Y2 (not built: replaced by the single trades list, see design §6.3)
- **Depends on:** T-017
- **Acceptance criteria:** tablet shell behaviour (sidebar collapses to top nav) shared by every later tablet screen; app on port 3001 with mobile tab bar (Trades, Explore, Alerts, Messages, Account) and desktop sidebar; no role switcher and no separate seller tab bar; certified merchants see Shop in place of Explore; Account holds Payouts for anyone who has sold and a Park Agent item that opens the hub application or, once active, `park.komtru.com`; offline state via service worker; `passport.komtru.com` host rewrite to public profile routes; `/hub/*` operating URLs redirect to `park.komtru.com` (design C12).

### T-111 — Entry and authentication
- **Screens:** E1, E2, E3, E3b, E4, D4, T3, AC2, AC3, TOS1, TOS2, TF1, TF2, social callback
- **Depends on:** T-110, T-032, T-034, T-036

### T-112 — First-time onboarding
- **Screens:** OB1, OB2, OB3, OB4 (web push permission), OB5
- **Depends on:** T-111, T-045

### T-113 — Home and discovery
- **Screens:** Z1, AC1, SE1, SE2, F1, F2, K1, K2, P2-D1, P2-D2, P2-D3, P2-D4, P2-T1, P2-T2, D5, T4
- **Depends on:** T-110, T-057, T-060

### T-114 — Seller profile and Trust Passport
- **Screens:** I1, I2, I4, P2-D5, D8, T5, C6
- **Depends on:** T-113, T-102

### T-115 — Create and propose a trade
- **Screens:** G1, G2, Z2, Z3, CTS1, I3, MI1, MI2, P2-D6, D6, P3-D1, P3-D2, P3-D3, P3-D4, P3-D5, P3-T1, P3-T2, G3, Q1, R1, AC4, IF1
- **Depends on:** T-061, T-062, T-063, T-067, T-049, T-110
- **Notes:** G1 and Z2 open with an "I'm buying / I'm selling" choice; certified merchants skip it and are always selling. Counterparty lookup warns before send when the chosen buyer is a certified merchant.

### T-116 — Buyer trade core and canonical trade detail
- **Screens:** C1, C2, C3, P0-03, D1, T2, C5, AR1
- **Depends on:** T-115, T-065, T-110
- **Notes:** C1 is one list of every trade the person is party to, as buyer or seller; each row and the trade detail show which side they are on. Seller-side actions open from the same trade detail.

### T-117 — Escrow funding
- **Screens:** V1, V2, V3, AB3, AB4
- **Depends on:** T-072, T-116, T-110
- **Known deviations (pre-approved by design §5):** V1 omits the "Logistics fee" line (C7, Q5); V2 uses Paystack pay-with-transfer (C8, Q6). Fee lines and totals come from the trade's fee snapshot via the API; the app never computes them.

### T-118 — Delivery, pickup PIN and inspection
- **Screens:** AB1, AB2, C4, Z4, Z5, BEI1, BEI2, DE1, DE2, DE3, DE4, MI4
- **Depends on:** T-065, T-093, T-116, T-110
- **Notes:** once Park is chosen, AB1 and AB2 show the cash handling-fee notice ("Bring ₦300–₦500 cash for the park agent at pickup. This is paid to the agent, not through Komtru"), with the range read from the API.

### T-119 — Cancellation and refunds
- **Screens:** CT1, CT2, CR1, CR2, CR3, SC1, SC2
- **Depends on:** T-066, T-110

### T-120 — Disputes (buyer and seller)
- **Screens:** C7, C8, H1, H2, Y1, AC6, D7, S7, S8
- **Depends on:** T-081, T-110

### T-121 — Apply for merchant certification
- **Screens:** SO1, SO2, SO3, SO4, SO5, BVR1, M2
- **Depends on:** T-055, T-051, T-073, T-110
- **Notes:** SO3 changes from optional to mandatory CAC upload, and Submit stays disabled until the CAC documents are attached. SO5 "Your shop is live" appears only after operations approval; until then the applicant sees a submitted, in-review state, and a changes-requested state that reopens the named fields. Both deviate from the reference and are listed in the visual check.

### T-122 — Shop and listings
- **Screens:** S1, S4, S5, EL1, EL2, D2, D3, T1
- **Depends on:** T-056, T-121, T-110
- **Notes:** Shop is a merchant-only area reached from the tab bar, not a separate view.

### T-123 — Seller trade handling and shipping
- **Screens:** S2, W1, W2, W3, BR1, SD1, S3, X1, X2, MI3, AC8
- **Depends on:** T-115, T-064, T-087, T-093, T-110
- **Notes:** X2 lists Park first, then every enabled courier company, then "Arrange my own shipping" (m2 §10).
- **Notes on Park:** choosing Park Hub Transit on X2 shows the same cash handling-fee notice so the seller can tell the buyer. Seller-side screens S2, W1–W3, BR1, SD1, S3, X1, X2, MI3 and AC8 are states of the shared trade detail and list, not a seller area.

### T-124 — Seller payouts
- **Screens:** S6, AB5, AB6, WF1, PR1
- **Depends on:** T-073, T-110
- **Notes:** Payouts live under Account and are available to anyone who has sold, not only merchants.

### T-125 — Seller insights
- **Screens:** AN1, AN2
- **Depends on:** T-105, T-110

### T-126 — Trust, account and settings
- **Screens:** J1, J2, J3, J4, M1, M3, VF1, AS1, AS2, CA1, CA2, LS1, C10, S10, NP1
- **Depends on:** T-050, T-039, T-045, T-102, T-110

### T-127 — Reviews
- **Screens:** AC5, SR1, SR2
- **Depends on:** T-102, T-110

### T-128 — Messaging
- **Screens:** C9, S9, AC7, MC1
- **Depends on:** T-108, T-110

### T-129 — Help and support
- **Screens:** L1, plus ticket create, list and detail (no reference screens beyond L1; built in the same design language, visual check is design-system conformance)
- **Depends on:** T-100, T-110

### T-130 — Park Hub application
- **Screens:** PH1, PH2, PH3, PH4, PH5, PH6, PA7, PA8
- **Notes:** the Account item shows the states "Not yet set up", application in review, and active. PH4 deviates from the reference: no payout setup, only an acknowledgement that agents collect the ₦300–₦500 handling fee from buyers in cash (design C23).
- **Depends on:** T-091, T-110

### T-131 — Wallet top-up
- **Status:** Blocked on design §12 Q3
- **Screens:** AB7
- **Depends on:** T-077, T-110, T-117
- **Default if unanswered:** screen implemented behind a disabled flag; the "Komtru Wallet" payment option in V1 hidden while the flag is off.
