# Komtru MVP — scope and path

**Decided 2026-10-06 by the owner: shape C, "escrow + merchant storefront".**

A buyer and a seller agree a trade, the buyer funds escrow, goods move by self-arranged
delivery, through a logistics company or via a Park hub (all three since 2026-11-19), the buyer inspects, money is released or the trade is disputed — and a certified
merchant can run a storefront with listings and search on top of that.

**63 features to MVP**, of 81 in all, tracked in [`tickets/FEATURE_MAP.md`](tickets/FEATURE_MAP.md); 32 are done. `pnpm progress` is the live count. **Widened 2026-11-19 by the owner** to take in the Park network, the logistics partner and the core TrustOps console (13 features, 33 tickets); see [the widening](#widened-2026-11-19-park-logistics-and-the-core-trustops-console).

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

## The MVP cut in features — 63 features

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

Home, trade search and the seller's Trust Passport. **Rescoped 2026-11-15 by the owner:** with listings
out of the MVP, home lists the user's own trades (past, and pending their acceptance) and search covers
trades only. Browse Categories (K1, K2) and the M19 listing index (T-057) go with the catalogue; the
`GET /trades` and `GET /trades/by-code/:code` endpoints already exist, so F-015 needs no new backend.
The Trust Passport pulls in reputation (T-102), which is why that ticket is in: both it and account
settings depend on it.

| Feature | Title                                       | Status      | Absorbs      |
| ------- | ------------------------------------------- | ----------- | ------------ |
| F-015   | Home, trade search and find-a-trade-by-code | Not started | T-113        |
| F-016   | View a seller's profile and Trust Passport  | Not started | T-114, T-102 |

### Propose & agree (4)

The core buyer and seller journey. IMEI check (F-020) and the automated risk hold (F-021) are deferred; phones are a large share of this market, so F-020 is the first thing to add back.

| Feature | Title                                          | Status      | Absorbs                           |
| ------- | ---------------------------------------------- | ----------- | --------------------------------- |
| F-017   | Propose a trade and invite the other party     | Done        | T-060, T-061, T-035, T-049, T-115 |
| F-018   | Create a trade: buyer starts, seller completes | Not started | T-192                             |
| F-019   | Create a trade: seller starts, buyer completes | Not started | T-193                             |
| F-021   | Hold a risky proposal for TrustOps review      | Not started | T-062, T-142                      |

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

### Issues & resolution (7)

Buyers and sellers must be able to open and follow a dispute, not only TrustOps (owner ruling, 2026-11-06). Return custody at a hub (F-036) stays deferred with Park, so returns are self-arranged.

| Feature | Title                                                           | Status      | Absorbs                    |
| ------- | --------------------------------------------------------------- | ----------- | -------------------------- |
| F-030   | Cancel a trade and get a refund                                 | Not started | T-066, T-075, T-119        |
| F-031   | Lifecycle exceptions: expiry, withdrawal and inspection updates | Not started | T-198                      |
| F-032   | Report an issue and open a dispute                              | Not started | T-080, T-081, T-120, T-196 |
| F-033   | Resolution execution: the return track                          | Not started | T-199                      |
| F-034   | Resolution execution: replacement and mutual settlement         | Not started | T-200                      |
| F-035   | Decide a dispute in TrustOps                                    | Not started | T-143                      |
| F-036   | Return custody at a Park hub                                    | Not started | T-201                      |

### Complete & grow (1)

Payouts only. Reviews and seller insights are after the first merchants are live.

| Feature | Title        | Status      | Absorbs      |
| ------- | ------------ | ----------- | ------------ |
| F-037   | Get paid out | Not started | T-073, T-124 |

### Sell on Komtru (1)

Merchant certification only. **Cut 2026-11-15 by the owner:** listings and stock (F-041), shop settings
and catalogue import (F-042) and multi-item orders (F-080) are deferred — a trade is proposed party to
party and never needs a catalogue, which F-017 already proved when multi-item ordering was split out of
it on 2026-11-09. Certification stays: it is the vendor trust story, and it now blocks nothing, so it
runs in the operations-app lane off the critical path. Customers, tax and badges (F-043) remain polish.

| Feature | Title                                                 | Status      | Absorbs                    |
| ------- | ----------------------------------------------------- | ----------- | -------------------------- |
| F-040   | Apply for merchant certification and have it reviewed | Not started | T-055, T-051, T-121, T-154 |

### Account, trust & support (3)

Addresses, identity verification and account lifecycle are in; messaging and help are deferred.

| Feature | Title                                                  | Status                       | Absorbs             |
| ------- | ------------------------------------------------------ | ---------------------------- | ------------------- |
| F-044   | Account basics, addresses, documents and system states | Backend done, UI outstanding | T-042, T-046, T-204 |
| F-045   | Verify yourself, and close or recover an account       | Backend done, UI outstanding | T-039, T-050, T-205 |
| F-046   | Trust history, account and notification settings       | Not started                  | T-126               |

### TrustOps console (7)

The MVP console is the work queue, identity review, disputes and merchant review, and since 2026-11-19 the core console: fraud signals, the risk hold on proposals, settlement and reconciliation, the staff directory and roles, and audit. Operations control, governance, treasury, field audits, people development, the TrustOps tablet and the console overview stay deferred.

| Feature | Title                                                 | Status                       | Absorbs             |
| ------- | ----------------------------------------------------- | ---------------------------- | ------------------- |
| F-049   | Staff sign-in, console shell and roles                | Done                         | T-037, T-038, T-140 |
| F-050   | Work queue and the universal case                     | Done                         | T-107, T-141        |
| F-051   | Review identity and KYC                               | Backend done, UI outstanding | T-052, T-144        |
| F-052   | Fraud signals and restrictions                        | Not started                  | T-101, T-145        |
| F-053   | Settlement operations, chargebacks and reconciliation | Not started                  | T-076, T-146        |
| F-054   | Directory, roles, approvals and impersonation         | Not started                  | T-103, T-150        |
| F-055   | Audit, compliance and the trust trail                 | Not started                  | T-104, T-152        |

### Park network (5, added 2026-11-19 by the owner)

The hub agent app and the custody network: apply to run a hub, log arrivals and hold items, hand them over with a pickup PIN, run the hub, and oversee the network from TrustOps. F-036 (return custody at a hub) joined Issues & resolution with it.

| Feature | Title                                               | Status      | Absorbs                    |
| ------- | --------------------------------------------------- | ----------- | -------------------------- |
| F-060   | Apply to run a Park hub and have it approved        | Not started | T-090, T-091, T-130, T-147 |
| F-061   | Log an arrival, inspect and hold an item in custody | Not started | T-092, T-170, T-171, T-172 |
| F-062   | Safe handover at the hub                            | Not started | T-093, T-173               |
| F-063   | Park fees, handover log, hub tools and stock count  | Not started | T-094, T-174, T-206        |
| F-064   | Park network oversight in TrustOps                  | Not started | T-095, T-148               |

### Logistics partner (2, added 2026-11-19 by the owner)

The partner portal and shipping through a logistics company, alongside self-arranged delivery.

| Feature | Title                                             | Status      | Absorbs                    |
| ------- | ------------------------------------------------- | ----------- | -------------------------- |
| F-065   | Logistics companies, teams and the partner portal | Not started | T-085, T-086, T-160, T-161 |
| F-066   | Ship through a logistics company                  | Not started | T-087, T-162, T-149        |

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
| F-075   | Hosting and real deploy jobs            | Done        | T-005   |
| F-076   | End-to-end critical paths               | Not started | T-180   |
| F-077   | Security review                         | Not started | T-182   |
| F-078   | Definition-of-done audit and first push | Not started | T-183   |

## Included — 105 tickets

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

### Merchant and storefront (1)

T-055 merchant applications and certification

### Trades (5)

T-061 proposal flow · T-064 fulfilment, ship step and
deadlines · T-065 inspection and completion · T-066 post-funding cancellation and can't-fulfil
refunds · T-068 trade realtime, notifications and deep links

### Money (4)

T-072 funding a trade · T-073 payout accounts and payouts · T-074 release and settlement ·
T-075 refunds

### Disputes and cases (3)

T-080 disputes core · T-081 evidence comparison and read models · T-107 universal case model,
work queue and advisory

### Web app (15)

T-017 Next.js foundation · T-110 scaffold and shells · T-111 entry and authentication · T-112
first-time onboarding · T-113 home and discovery · T-114 seller profile and Trust Passport ·
T-115 create and propose a trade · T-116 buyer trade core and trade detail · T-117 escrow
funding · T-118 delivery and inspection · T-119 cancellation and refunds · T-121 apply for
merchant certification · T-123 seller trade handling and shipping ·
T-124 seller payouts · T-126 trust, account and settings

### Operations console (5)

T-140 scaffold, shell and staff auth · T-141 work queue and universal case · T-143 disputes ·
T-144 identity review · T-154 merchant certification review

### UI master v2 (16, added 2026-11-06)

T-190 remaps the screen index to Living Master v2 and re-scopes the UI tickets; every MVP UI
ticket depends on it. It adds 30 tickets, 15 of them MVP, listed here:

- **T-191** rework T-110 shells to v2: the desktop sidebar, tablet top nav and Buy/Sell mode
  switch every MVP desktop and tablet screen sits in.
- **T-192, T-193** create a trade, the four-stage flows: the core buyer and seller journey.
- **T-194** workspace supporting screens, funding, terms and payment: the escrow path.
- **T-195** workspace supporting screens, delivery and evidence: self-arranged delivery.
- **T-197** proof media: mandatory seller proof and buyer comparison, the heart of inspection.
- **T-198** lifecycle exceptions and trade extras: expiry, withdrawal and inspection updates.
- **T-204** account basics, money documents and system states: addresses, refunds, session errors.
- **T-205** account security and lifecycle: MFA, suspension and closure, which T-036 and T-039 serve.
- **T-207, T-208, T-209** desktop journeys, arrive to complete: the desktop layouts of MVP journeys.
- **T-212, T-213** tablet journeys, arrive to complete: the tablet layouts of the same journeys.
- **T-222** re-base `TabBar` to v2 mobile styling: the indigo-soft active pill, 20px icons and 10px labels
  (found in the T-191 review).

### Disputes for buyers and sellers (5, added 2026-11-06 by the owner)

The owner ruled that buyers and sellers must be able to open and follow a dispute in the MVP,
not only TrustOps. Return custody at a hub (T-201) came in with Park on 2026-11-19, so a return can
be self-arranged or go through a hub.

- **T-120** disputes (buyer and seller), the mobile web dispute screens.
- **T-196** trade workspace resolution and issue-reporting screens.
- **T-199** resolution execution, the return track (Track A).
- **T-200** resolution execution, replacement and mutual settlement (Tracks B and C).
- **T-221** desktop and tablet issues and resolution, split out of T-210 and T-214.

### Park network (16, added 2026-11-19 by the owner)

T-090 Park schema ·
T-091 hub onboarding, activation and lifecycle ·
T-130 Park hub application ·
T-147 Park applications, registration and lifecycle ·
T-092 custody operations API ·
T-170 app scaffold, login and hub context ·
T-171 hub dashboard and log arrival ·
T-172 inspection, damage and incidents ·
T-093 Park and trade integration ·
T-173 safe handover ·
T-094 Park cash-fee notices and handover log ·
T-174 handover log, hub profile and staff ·
T-206 park agent hub tools and hub count ·
T-095 Park TrustOps read models ·
T-148 Park network and custody ·
T-201 resolution execution: return custody at the hub

### Logistics (7, added 2026-11-19 by the owner)

T-085 logistics schema and Park seed ·
T-086 logistics auth, companies and members ·
T-160 portal scaffold and login ·
T-161 team management ·
T-087 package pipeline and ship-to-company ·
T-162 packages ·
T-149 logistics companies and packages

### Core TrustOps console (10, added 2026-11-19 by the owner)

T-101 risk and fraud (M13) ·
T-145 fraud signals and restrictions ·
T-076 chargebacks, reconciliation and settlement operations ·
T-146 settlement operations ·
T-103 administration: impersonation and admin action log (M14, adapted) ·
T-150 directory, roles and approvals ·
T-104 audit and compliance (M15) ·
T-152 audit and compliance ·
T-062 proposal risk hold and TrustOps review ·
T-142 trade proposals

### Release (4)

T-005 hosting and deploy jobs · T-180 end-to-end critical paths · T-182 security review ·
T-183 definition-of-done audit and first push

## Dependency edits the MVP requires

Since 2026-11-19 Park, logistics and the risk hold are in the MVP, so the edits that dropped T-093, T-087, T-062, T-173, T-162 and T-148 no longer apply and are gone from this table.

Each of these removes a dependency on a deferred ticket. None of them changes what the
depending ticket does for a user; each narrows what it covers.

| Ticket                           | Drop                         | Consequence                                                                                      |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| T-111 entry and authentication   | T-034 social login           | Email, phone and handle login only. Social sign-in is a conversion lever worth revisiting early. |
| T-115 create and propose a trade | T-067 IMEI                   | No IMEI check. Phones are a large share of this market, so T-067 is the first thing to add back. |
| T-183 first push                 | everything outside this list | Gates the push on the MVP set rather than on all 166.                                            |

## Widened 2026-11-19: Park, logistics and the core TrustOps console

The owner brought three surfaces into the MVP that were deferred as blocks: the Park hub network (F-060–F-064 and F-036, return custody at a hub), the logistics partner (F-065, F-066) and the core TrustOps console (F-052 fraud signals, F-021 the proposal risk hold, F-053 settlement and reconciliation, F-054 directory and roles, F-055 audit). That is 13 features and 33 tickets. The rest of the console (F-056–F-059) stays deferred, so F-039 seller insights, which F-056 would have needed, stays deferred too. Every dependency of the 13 is either already in the MVP or one of the 13.

Two consequences. F-076's end-to-end paths now include the Park handover, ship-to-company and network console paths. And `logistics-ops` and `park-agent-app` need hosts, which F-075 left for this wave: F-065 and F-060 each bring theirs up.

## Deferred — 31 tickets

- **Catalogue and storefront, 5 (deferred 2026-11-15 by the owner):** T-056 listings lifecycle,
  images and stock · T-057 search and discovery (the M19 listing index) · T-063 orders and
  multi-item trades · T-122 shop and listings · T-202 shop settings and catalogue import.
  Trades are proposed party to party, so none of the MVP journeys needs a catalogue.

- **Risk, trust and growth, 5:** T-067, T-106, T-127, T-128, T-108.
- **Money extensions, 2:** T-077 and T-131 wallet.
- **Support and admin, 7:** T-034, T-041, T-100, T-105, T-125, T-129, T-151.
- **Console and misc, 2:** T-153, T-155.
- **UI master v2, 9:** each is deferred because the buyer or seller feature it draws is deferred,
  or because it belongs to a console or hub surface the MVP does not build.
  - T-210 desktop messages, trust and account: messaging is deferred. Its dispute screens moved to T-221 (MVP).
  - T-203 seller customers, tax and badges: storefront polish after the first merchants are live.
  - T-211 desktop help and settings, T-214 tablet messages, account and help: help and messaging are deferred.
  - T-215 operations control, T-216 governance, T-217 treasury, T-218 field audits, T-219 people
    development and T-220 TrustOps tablet: beyond the core console the MVP takes in.
- **T-181 load and resilience** — deliberately after the MVP ships, when there is real traffic
  shape to test against.

## Open decisions that touch this path

- **Q1 — hosting target and the GitHub remote.** Answered 2026-11-19: EC2 for the backend,
  Vercel for the web apps, GitHub `Komtru/komtru-web-mono-repo` as the remote. T-005 is done.
- **Q16 — which cities seed the location catalog.** Gates T-046, which sits under saved
  addresses and the proposal flow. This one blocks early, not late.
- **Q3 — ship the Wallet?** Both wallet tickets are deferred either way, so this does not
  affect the MVP path.
