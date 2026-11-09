# Komtru MVP — scope and path

**Decided 2026-10-06 by the owner: shape C, "escrow + merchant storefront".**

A buyer and a seller agree a trade, the buyer funds escrow, goods move by self-arranged
delivery, the buyer inspects, money is released or the trade is disputed — and a certified
merchant can run a storefront with listings and search on top of that.

**51 features to MVP**, of 79 in all, tracked in [`tickets/FEATURE_MAP.md`](tickets/FEATURE_MAP.md); 13 are done. As tickets the same cut is 77 listed tickets on top of the work already done, of 168 in all. The headline is the feature count: 13/51 (25%), not the ticket count it replaced.

> The full ticket list is [`TICKETS.md`](TICKETS.md); it is not reorganised by this document.
> This is the cut through it, and the record of why each line sits where it does.

## What the plan does not do on its own

The ticket graph was written for the whole product, so an MVP is not a prefix of it. Three
things in particular have to be changed deliberately rather than waited out:

- **T-183 ("definition-of-done audit and first push") depends on every other ticket.** Nothing
  ships until all 166 are done. For the MVP it must depend on the MVP set only.
- **T-118 (web delivery, pickup PIN and inspection) depends on T-093 (Park and trade
  integration).** The buyer's own delivery screen pulls in the entire Park hub network —
  schema, custody API, the Park agent app and its console, 16 tickets.
- **T-180 (end-to-end critical paths) depends on T-173, T-162 and T-148** — Park safe handover,
  logistics packages and the Park network console. Its definition of "end to end" spans two
  apps the MVP does not build.

## The MVP cut in features — 51 features

This is the cut as the project now measures it. Each feature carries its backend and its frontend, and is done only when a user can do the thing in an app. The definitions live in [`tickets/FEATURE_MAP.md`](tickets/FEATURE_MAP.md); the tickets each one absorbs are listed alongside, and the ticket listing further down is the same cut as tickets, kept so the history stays traceable.

**Why the headline moved from 58/109 (53%) to 13/51 (25%).** The measure changed, not the work. The old figure counted tickets, and 51 of the 58 finished tickets are backend layers while the consumer app cannot yet list a trade. The new figure counts usable features, and a feature whose engine is built but whose screens are not (the six marked _Backend done, UI outstanding_) is not done. No work was lost: every finished ticket is still counted, inside the feature it belongs to.

### Platform (not a user journey) (10)

Infrastructure every journey stands on. F-005 (test isolation) is the one open item; it is cross-cutting, so it never runs beside other work.

| Feature | Title                                                                  | Status      | Absorbs                                                |
| ------- | ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------ |
| F-001   | Repo, toolchain and continuous integration                             | Done        | T-001, T-002, T-003, T-004, T-006                      |
| F-002   | Shared design system, ui-kit and app foundations                       | Done        | T-010, T-011, T-012, T-013, T-014, T-015, T-016, T-017 |
| F-003   | Backend skeleton, database, migrations, jobs and events                | Done        | T-020, T-021, T-022, T-023, T-024                      |
| F-004   | Backend cross-cutting: HTTP contract, crypto and the provider boundary | Done        | T-025, T-026, T-028                                    |
| F-005   | Deterministic integration test suite                                   | Not started | T-029                                                  |
| F-006   | Platform configuration and the fee schedule                            | Done        | T-047, T-048                                           |
| F-007   | Notification delivery and the realtime transport                       | Done        | T-045, T-027                                           |
| F-008   | Media and evidence storage                                             | Done        | T-040, T-041                                           |
| F-009   | Double-entry ledger core and the payment provider adapter              | Done        | T-070, T-071                                           |
| F-010   | Screen index remap to UI Living Master v2                              | Done        | T-190                                                  |

### Arrive & verify (3)

Getting in. Social sign-in (F-014) stays out: email, phone and handle login only, as the dependency edits below record.

| Feature | Title                                                  | Status      | Absorbs                                  |
| ------- | ------------------------------------------------------ | ----------- | ---------------------------------------- |
| F-011   | Sign up, verify a phone, sign in and secure the device | Done        | T-030, T-031, T-032, T-033, T-036, T-111 |
| F-012   | App shell, navigation and the Buy/Sell mode switch     | Done        | T-110, T-191, T-222                      |
| F-013   | First-time onboarding walkthrough                      | Not started | T-112                                    |

### Home & discover (2)

Search and the seller's Trust Passport. The Trust Passport pulls in reputation (T-102), which is why that ticket is in: both it and account settings depend on it.

| Feature | Title                                             | Status      | Absorbs      |
| ------- | ------------------------------------------------- | ----------- | ------------ |
| F-015   | Home, search, categories and find-a-trade-by-code | Not started | T-113, T-057 |
| F-016   | View a seller's profile and Trust Passport        | Not started | T-114, T-102 |

### Propose & agree (3)

The core buyer and seller journey. IMEI check (F-020) and the automated risk hold (F-021) are deferred; phones are a large share of this market, so F-020 is the first thing to add back.

| Feature | Title                                                            | Status      | Absorbs                                  |
| ------- | ---------------------------------------------------------------- | ----------- | ---------------------------------------- |
| F-017   | Propose a trade, invite the other party and order multiple items | Not started | T-060, T-061, T-035, T-049, T-063, T-115 |
| F-018   | Create a trade: buyer starts, seller completes                   | Not started | T-192                                    |
| F-019   | Create a trade: seller starts, buyer completes                   | Not started | T-193                                    |

### The trade workspace (2)

One role-aware workspace every later trade journey renders inside.

| Feature | Title                                                | Status      | Absorbs      |
| ------- | ---------------------------------------------------- | ----------- | ------------ |
| F-022   | Follow a trade in one role-aware workspace           | Not started | T-116, T-068 |
| F-023   | Terms, agreement and payment detail in the workspace | Not started | T-194        |

### Fund & protect (1)

The escrow path. The Wallet (F-025) is deferred either way (Q3).

| Feature | Title       | Status                       | Absorbs      |
| ------- | ----------- | ---------------------------- | ------------ |
| F-024   | Fund escrow | Backend done, UI outstanding | T-072, T-117 |

### Fulfil & dispatch (1)

The seller marks a trade shipped and supplies their own tracking; no ship-to-company.

| Feature | Title                                   | Status                       | Absorbs      |
| ------- | --------------------------------------- | ---------------------------- | ------------ |
| F-026   | Accept, prove, prepare and ship an item | Backend done, UI outstanding | T-064, T-123 |

### Deliver & inspect (3)

Self-arranged delivery and inspection only: no hub custody and no Park pickup PIN.

| Feature | Title                                           | Status                       | Absorbs             |
| ------- | ----------------------------------------------- | ---------------------------- | ------------------- |
| F-027   | Confirm delivery, inspect, complete and release | Backend done, UI outstanding | T-065, T-074, T-118 |
| F-028   | Delivery and evidence in the workspace          | Not started                  | T-195               |
| F-029   | Capture and compare proof media                 | Not started                  | T-197               |

### Issues & resolution (6)

Buyers and sellers must be able to open and follow a dispute, not only TrustOps (owner ruling, 2026-11-06). Return custody at a hub (F-036) stays deferred with Park, so returns are self-arranged.

| Feature | Title                                                           | Status      | Absorbs                    |
| ------- | --------------------------------------------------------------- | ----------- | -------------------------- |
| F-030   | Cancel a trade and get a refund                                 | Not started | T-066, T-075, T-119        |
| F-031   | Lifecycle exceptions: expiry, withdrawal and inspection updates | Not started | T-198                      |
| F-032   | Report an issue and open a dispute                              | Not started | T-080, T-081, T-120, T-196 |
| F-033   | Resolution execution: the return track                          | Not started | T-199                      |
| F-034   | Resolution execution: replacement and mutual settlement         | Not started | T-200                      |
| F-035   | Decide a dispute in TrustOps                                    | Not started | T-143                      |

### Complete & grow (1)

Payouts only. Reviews and seller insights are after the first merchants are live.

| Feature | Title        | Status      | Absorbs      |
| ------- | ------------ | ----------- | ------------ |
| F-037   | Get paid out | Not started | T-073, T-124 |

### Sell on Komtru (3)

The merchant storefront. Business verification and certification are in because a merchant cannot be certified without them. Customers, tax and badges (F-043) are storefront polish.

| Feature | Title                                                 | Status      | Absorbs                    |
| ------- | ----------------------------------------------------- | ----------- | -------------------------- |
| F-040   | Apply for merchant certification and have it reviewed | Not started | T-055, T-051, T-121, T-154 |
| F-041   | List items and manage stock                           | Not started | T-056, T-122               |
| F-042   | Shop settings and catalogue import                    | Not started | T-202                      |

### Account, trust & support (3)

Addresses, identity verification and account lifecycle are in; messaging and help are deferred.

| Feature | Title                                                  | Status                       | Absorbs             |
| ------- | ------------------------------------------------------ | ---------------------------- | ------------------- |
| F-044   | Account basics, addresses, documents and system states | Backend done, UI outstanding | T-042, T-046, T-204 |
| F-045   | Verify yourself, and close or recover an account       | Backend done, UI outstanding | T-039, T-050, T-205 |
| F-046   | Trust history, account and notification settings       | Not started                  | T-126               |

### TrustOps console (3)

The MVP console is the work queue, identity review and, with disputes and merchant review, nothing more.

| Feature | Title                                  | Status                       | Absorbs             |
| ------- | -------------------------------------- | ---------------------------- | ------------------- |
| F-049   | Staff sign-in, console shell and roles | Done                         | T-037, T-038, T-140 |
| F-050   | Work queue and the universal case      | Done                         | T-107, T-141        |
| F-051   | Review identity and KYC                | Backend done, UI outstanding | T-052, T-144        |

### Desktop & tablet journeys (6)

The desktop and tablet layouts of MVP journeys. Messaging, help, operations control, governance, treasury, field audits and people development are deferred.

| Feature | Title                                            | Status      | Absorbs |
| ------- | ------------------------------------------------ | ----------- | ------- |
| F-067   | Desktop: arrive, home and discover               | Not started | T-207   |
| F-068   | Desktop: propose, agree and fund                 | Not started | T-208   |
| F-069   | Desktop: fulfil, deliver, inspect and complete   | Not started | T-209   |
| F-070   | Desktop and tablet: issues and resolution        | Not started | T-221   |
| F-072   | Tablet: arrive, home, discover, propose and fund | Not started | T-212   |
| F-073   | Tablet: fulfil, deliver, inspect and payouts     | Not started | T-213   |

### Launch & assurance (not a user journey) (4)

Hosting, end-to-end paths, security review and the first push. F-079 (load and resilience) is deliberately after the MVP ships.

| Feature | Title                                   | Status      | Absorbs |
| ------- | --------------------------------------- | ----------- | ------- |
| F-075   | Hosting and real deploy jobs            | Not started | T-005   |
| F-076   | End-to-end critical paths               | Not started | T-180   |
| F-077   | Security review                         | Not started | T-182   |
| F-078   | Definition-of-done audit and first push | Not started | T-183   |

## Included — 77 tickets

The same cut as tickets, the secondary mapping. `tools/tickets/progress.py` reads this listing for the ticket-layer view (`pnpm progress --tickets`) and fails if it disagrees with the counts stated here.

### Identity and platform (13)

T-029 test isolation · T-035 party lookup and invitations · T-036 devices, MFA and passkeys ·
T-037 RBAC, staff login and admin endpoints · T-038 staff invitations · T-039 account lifecycle,
recovery and NDPA hooks · T-042 saved delivery addresses · T-046 location catalog · T-048
configuration · T-049 trade standards by category · T-050 verification core (NIN/BVN, liveness,
levels) · T-051 business verification · T-052 duplicate identity detection and KYC review queue

T-051 and T-052 are in because the storefront needs them: a merchant cannot be certified
without business verification, and the console's identity review queue is T-052's.

### Trust (1)

T-102 reputation and ratings — in because both T-114 (Trust Passport) and T-126 (account and
settings) depend on it. Deferring it would gut two screens the MVP needs.

### Merchant and storefront (3)

T-055 merchant applications and certification · T-056 listings lifecycle, images and stock ·
T-057 search and discovery

### Trades (6)

T-061 proposal flow · T-063 orders and multi-item trades · T-064 fulfilment, ship step and
deadlines · T-065 inspection and completion · T-066 post-funding cancellation and can't-fulfil
refunds · T-068 trade realtime, notifications and deep links

### Money (4)

T-072 funding a trade · T-073 payout accounts and payouts · T-074 release and settlement ·
T-075 refunds

### Disputes and cases (3)

T-080 disputes core · T-081 evidence comparison and read models · T-107 universal case model,
work queue and advisory

### Web app (16)

T-017 Next.js foundation · T-110 scaffold and shells · T-111 entry and authentication · T-112
first-time onboarding · T-113 home and discovery · T-114 seller profile and Trust Passport ·
T-115 create and propose a trade · T-116 buyer trade core and trade detail · T-117 escrow
funding · T-118 delivery and inspection · T-119 cancellation and refunds · T-121 apply for
merchant certification · T-122 shop and listings · T-123 seller trade handling and shipping ·
T-124 seller payouts · T-126 trust, account and settings

### Operations console (5)

T-140 scaffold, shell and staff auth · T-141 work queue and universal case · T-143 disputes ·
T-144 identity review · T-154 merchant certification review

### UI master v2 (17, added 2026-11-06)

T-190 remaps the screen index to Living Master v2 and re-scopes the UI tickets; every MVP UI
ticket depends on it. It adds 30 tickets, 15 of them MVP, listed here:

- **T-191** rework T-110 shells to v2: the desktop sidebar, tablet top nav and Buy/Sell mode
  switch every MVP desktop and tablet screen sits in.
- **T-192, T-193** create a trade, the four-stage flows: the core buyer and seller journey.
- **T-194** workspace supporting screens, funding, terms and payment: the escrow path.
- **T-195** workspace supporting screens, delivery and evidence: self-arranged delivery.
- **T-197** proof media: mandatory seller proof and buyer comparison, the heart of inspection.
- **T-198** lifecycle exceptions and trade extras: expiry, withdrawal and inspection updates.
- **T-202** seller shop settings and catalogue import: the merchant storefront.
- **T-204** account basics, money documents and system states: addresses, refunds, session errors.
- **T-205** account security and lifecycle: MFA, suspension and closure, which T-036 and T-039 serve.
- **T-207, T-208, T-209** desktop journeys, arrive to complete: the desktop layouts of MVP journeys.
- **T-212, T-213** tablet journeys, arrive to complete: the tablet layouts of the same journeys.
- **T-222** re-base `TabBar` to v2 mobile styling: the indigo-soft active pill, 20px icons and 10px labels
  (found in the T-191 review).

### Disputes for buyers and sellers (5, added 2026-11-06 by the owner)

The owner ruled that buyers and sellers must be able to open and follow a dispute in the MVP,
not only TrustOps. Return custody at a hub (T-201) stays deferred with Park, so returns are
self-arranged.

- **T-120** disputes (buyer and seller), the mobile web dispute screens.
- **T-196** trade workspace resolution and issue-reporting screens.
- **T-199** resolution execution, the return track (Track A).
- **T-200** resolution execution, replacement and mutual settlement (Tracks B and C).
- **T-221** desktop and tablet issues and resolution, split out of T-210 and T-214.

### Release (4)

T-005 hosting and deploy jobs · T-180 end-to-end critical paths · T-182 security review ·
T-183 definition-of-done audit and first push

## Dependency edits the MVP requires

Each of these removes a dependency on a deferred ticket. None of them changes what the
depending ticket does for a user; each narrows what it covers.

| Ticket                             | Drop                                 | Consequence                                                                                                                                     |
| ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| T-111 entry and authentication     | T-034 social login                   | Email, phone and handle login only. Social sign-in is a conversion lever worth revisiting early.                                                |
| T-115 create and propose a trade   | T-062 risk hold, T-067 IMEI          | No automated risk hold on a proposal and no IMEI check. Phones are a large share of this market, so T-067 is the first thing to add back.       |
| T-118 delivery and inspection      | T-093 Park integration               | Self-arranged delivery and inspection only — no hub custody, no Park pickup PIN.                                                                |
| T-123 seller handling and shipping | T-087 logistics packages, T-093 Park | The seller marks a trade shipped and supplies their own tracking; no ship-to-company.                                                           |
| T-180 end-to-end critical paths    | T-173, T-162, T-148                  | "End to end" means propose → fund → deliver → inspect → release, plus the dispute path. Park and logistics journeys are added with those waves. |
| T-183 first push                   | everything outside this list         | Gates the push on the MVP set rather than on all 166.                                                                                           |

## Deferred — 60 tickets

- **Park, 16:** T-090–T-095, T-130, T-147, T-148, T-170–T-174. The signature feature, and the
  largest single block. It is the first wave after MVP.
- **Logistics, 7:** T-085, T-086, T-087, T-149, T-160, T-161, T-162.
- **Risk, trust and growth, 8:** T-062, T-067, T-101, T-106, T-127, T-128, T-108, T-145.
- **Money extensions, 4:** T-076 chargebacks, T-077 and T-131 wallet, T-146 settlement ops.
- **Support and admin, 11:** T-034, T-041, T-100, T-103, T-104, T-105, T-125, T-129, T-150,
  T-151, T-152.
- **Console and misc, 3:** T-142, T-153, T-155.
- **UI master v2, 11:** each is deferred because the buyer or seller feature it draws is deferred,
  or because it belongs to a console or hub surface the MVP does not build.
  - T-210 desktop messages, trust and account: messaging is deferred. Its dispute screens moved to T-221 (MVP).
  - T-201 Track D return custody and T-206 hub tools and count: Park is deferred.
  - T-203 seller customers, tax and badges: storefront polish after the first merchants are live.
  - T-211 desktop help and settings, T-214 tablet messages, account and help: help and messaging are deferred.
  - T-215 operations control, T-216 governance, T-217 treasury, T-218 field audits, T-219 people
    development and T-220 TrustOps tablet: the MVP console is the work queue, disputes, identity
    review and merchant review only.
- **T-181 load and resilience** — deliberately after the MVP ships, when there is real traffic
  shape to test against.

## Open decisions that touch this path

- **Q1 — hosting target and the GitHub remote.** Gates T-005 and the first push at T-183.
  Nothing else is blocked by it, so it can be answered late, but it is on the MVP's last step.
- **Q16 — which cities seed the location catalog.** Gates T-046, which sits under saved
  addresses and the proposal flow. This one blocks early, not late.
- **Q3 — ship the Wallet?** Both wallet tickets are deferred either way, so this does not
  affect the MVP path.
