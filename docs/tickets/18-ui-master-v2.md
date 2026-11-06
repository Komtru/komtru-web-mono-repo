# Epic 18 — Adopt UI Living Master v2

The owner supplied a new UI/UX master on 2026-11-06:
[`docs/design-reference/Komtru — UI Living Master v2.html`](../design-reference/Komtru%20—%20UI%20Living%20Master%20v2.html).
It supersedes the v1 file for every UI ticket not yet done. v1 stays in the repo because the
visual checks of finished tickets point at it.

What changed, from [`screens-v2.tsv`](../design-reference/screens-v2.tsv) (437 screens against v1's 210):

- **127 screens carried over** with the same id, 310 new, 63 v1 ids gone.
- **Trade detail replaced.** v1's D1–D9 and T1–T5 are gone. In their place are the
  "Canonical Mobile Architecture — Trade Workspace · Tabbed" (9), "Trade Workspace — Supporting
  Screens" (18), "Funding & Terms" (4), "Lifecycle Exceptions" (4), "Proof media" (8) and
  "Trade extras" (5). They describe one role-aware trade surface instead of separate buyer and seller screens.
- **Create a Trade became a four-stage model.** 20 screens cover Buyer starts, Seller completes,
  Seller starts and Buyer completes.
- **Resolution execution added.** 19 screens: Track B replacement, Track C mutual settlement and Track D return custody.
- **Desktop and tablet redrawn.** v1's P0, P2 and P3 screens are gone. They are replaced by
  Desktop 01–11 (45 screens) and Tablet 01–11 (26), organised by journey.
- **TrustOps console redrawn.** v1's TO-PA1–11 and TO1 are gone. They are replaced by TrustOps
  01–25 (about 85 screens), which go well past the old console tickets: governance, treasury,
  field audits, people development, partners and configuration.
- **Seller and hub supporting screens added.** These cover shop settings, catalogue import,
  customers, tax and badges, hub tools and hub count.

---

### T-190 — Remap the screen index to Living Master v2 and re-scope the UI tickets

- **Status:** Done (2026-11-06). Plan: inline in this ticket. Review: pending.
- **Depends on:** none
- **Model:** sonnet (planning and documentation, no product code)
- **Files:** `docs/design-reference/SCREEN_INDEX.md`, `docs/tickets/13-web-app-ui.md`,
  `docs/tickets/14-operations-app.md`, `docs/tickets/15-logistics-ops.md`,
  `docs/tickets/16-park-agent-app.md`, this file, `docs/MVP.md`, `tools/visual-check` line references.
- **Acceptance criteria:**
  1. `SCREEN_INDEX.md` is regenerated against v2. Every row of `screens-v2.tsv` maps to exactly
     one ticket. Line numbers point into the v2 file, and the v1 index is kept as `SCREEN_INDEX-v1.md`.
  2. Each undone UI ticket's scope and acceptance criteria name its v2 screens. Screens no
     existing ticket fits get new tickets in this epic (T-191 onward), sized to one ticket cycle.
     A ticket of about 12 screens or fewer counts as one cycle. Each new ticket gets dependencies
     and a model hint.
  3. Every new ticket is marked MVP or deferred in `docs/MVP.md`, with a one-line reason. The
     MVP rule is shape C (escrow + merchant storefront): buyer and seller mobile web, the
     desktop/tablet layouts of those same journeys, and the TrustOps screens that MVP cases need
     (work queue, disputes, identity review, merchant review). Everything else is deferred.
  4. Rework of finished UI work is listed as
     one rework ticket per affected ticket. That is T-110, plus any partial UI already on `main`; `docs/ui-review/` has folders for T-111, T-113, T-114, T-122 and T-140. Each covers only screens whose v2 design differs
     materially. A carried screen whose markup is unchanged needs no rework.
  5. `pnpm tickets:index` runs with no errors or cycles, and `pnpm progress --write` reflects the new totals.

### T-191 — Rework T-110 shells to the v2 desktop, tablet and mode switch

- **Status:** Done (2026-11-06). Plan: docs/superpowers/plans/2026-11-06-t-191-v2-shell-rework.md. Review: 12 items fixed. Owner ruling 2026-11-06: mobile uses the same Buy/Sell switch in its header, not Y2's role list.
- **Depends on:** T-110, T-190
- **Model:** sonnet
- **Scope:** The one rework ticket. T-110 is the only UI on `main`; it built the app scaffold and the shells against v1's D9 (sidebar shell, Account, Personal Info) and tablet top nav. v2 redraws the shell: a five-item nav (Home, Trades, Messages, Discover, Account) in a sidebar with Collapse and `/` to search on desktop, the same five items as top navigation on tablet, and a Buy/Sell mode switch beside the profile (Y2). T-110's OF1 offline screen is unchanged (the v2 text and markup match v1), so it needs no rework. Update the sidebar and top-nav items, add the mode switch and the global search and Trade Code bar, and re-run the T-110 visual checks against v2 (DX-03, DX-37, TX-02 frames). Mobile tab bar: confirm against the v2 mobile frames and change only if they differ. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 1 v2 screens Y2 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-192 — Create a trade: buyer starts, seller completes

- **Depends on:** T-115, T-061, T-063, T-049, T-046, T-190
- **Model:** sonnet
- **Scope:** The first two stages of the four-stage model: the buyer starts a trade (About, Item and delivery for Courier or Park, Trade terms, Review and send, Sent) and the seller completes the request (details, item, delivery, confirm and send back), with the buyer's final review and accept (CT-B10). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 12 v2 screens CT-B1, CT-B2, CT-B2P, CT-B3, CT-B4, CT-B5, CT-B6, CT-B7, CT-B8, CT-B8P, CT-B9, CT-B10 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-193 — Create a trade: seller starts, buyer completes

- **Depends on:** T-115, T-192, T-061, T-063, T-049, T-046, T-190
- **Model:** sonnet
- **Scope:** The mirror flow: the seller starts (About, category item details including Fashion & Luxury, terms, review and send, Sent) and the buyer chooses how to receive it (CT-S6) and reviews and accepts (CT-S7). Reuses the stage components from T-192. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 8 v2 screens CT-S1, CT-S2, CT-S2F, CT-S3, CT-S4, CT-S5, CT-S6, CT-S7 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-194 — Trade workspace supporting screens: funding, terms, agreement and payment

- **Depends on:** T-116, T-061, T-072, T-190
- **Model:** sonnet
- **Scope:** The funding-side screens behind the canonical tabbed workspace (T-116): Funding & Terms (TW-01 to TW-04), the trade-expired exception (EX-01), the accepted agreement and its version history, and the payment sequence (method, review, processing, protected, failed or expired). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 12 v2 screens TW-01, TW-02, TW-03, TW-04, EX-01, CWT-S01, CWT-S02, CWT-S03, CWT-S04, CWT-S05, CWT-S06, CWT-S07 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-195 — Trade workspace supporting screens: delivery and evidence

- **Depends on:** T-116, T-064, T-065, T-040, T-190
- **Model:** sonnet
- **Scope:** The delivery and evidence screens behind the tabbed workspace: dispatch readiness, waybill and handover, tracking and custody, Park pickup, trade media and evidence submit. The Park parts (CWT-S09, CWT-S11) are built behind the same T-093 dependency edit as T-118, so the MVP renders the self-arranged path only. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens CWT-S08, CWT-S09, CWT-S10, CWT-S11, CWT-S12, CWT-S13 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-196 — Trade workspace supporting screens: resolution and issue reporting

- **Depends on:** T-116, T-120, T-080, T-081, T-190
- **Model:** sonnet
- **Scope:** The resolution screens behind the tabbed workspace: report an issue (single item and mixed orders), choose the item, case status and settlement, plus the structured report (DI-01) and withdraw a dispute (SP-M23). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 7 v2 screens DI-01, CWT-S14, CWT-S15, CWT-S16, CWT-S17, CWT-S18, SP-M23 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-197 — Proof media: capture, check and compare

- **Depends on:** T-116, T-040, T-064, T-065, T-190
- **Model:** sonnet
- **Scope:** Mandatory seller proof of the item (add media, guided camera shots, photo check, ready), how the buyer reviews it at request stage, the evidence trail on an active trade, inspection compare, and the after-completion Trade record (PM-1 to PM-8). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 8 v2 screens PM-1, PM-2, PM-3, PM-4, PM-5, PM-6, PM-7, PM-8 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-198 — Lifecycle exceptions and trade extras

- **Depends on:** T-116, T-065, T-066, T-042, T-045, T-190
- **Model:** sonnet
- **Scope:** Withdrawal recorded (WD-01), inspection update (IE-03), scan a Trade Code, trade history with search, change delivery address after funding, and the durable trade notifications list. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens WD-01, IE-03, SP-M20, SP-M21, SP-M22, SP-M24 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-199 — Resolution execution: return track

- **Depends on:** T-120, T-075, T-080, T-190
- **Model:** sonnet
- **Scope:** Track A, an approved return, from both sides: approved, send it back, hand it over, in transit, incoming and check the return (seller), refund released, under review, return window closed, and the buyer's return receipt and pickup booking (RX-18, RX-19 are the buyer's side of the hub return). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 11 v2 screens RX-01, RX-02, RX-03, RX-04, RX-05, RX-06, RX-07, RX-08, RX-09, RX-18, RX-19 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-200 — Resolution execution: replacement and mutual settlement

- **Depends on:** T-199, T-080, T-075, T-190
- **Model:** sonnet
- **Scope:** Track B (replacement approved, seller ships the replacement) and Track C (propose a settlement, offer, counter-offer, agreed). Amounts shown come from the API; the app computes nothing. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens RX-10, RX-11, RX-12, RX-13, RX-14, RX-15 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-201 — Resolution execution: return custody at the hub

- **Depends on:** T-199, T-092, T-093, T-171, T-190
- **Model:** sonnet
- **Scope:** Track D on the Park agent app: log a return, return logged, hand the return to the courier, return dispatched (RX-16, RX-17, RX-20, RX-21). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 4 v2 screens RX-16, RX-17, RX-20, RX-21 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-202 — Seller shop settings and catalogue import

- **Depends on:** T-122, T-056, T-051, T-190
- **Model:** sonnet
- **Scope:** Shop profile and address, pause my shop, delivery settings, shop team and the fee statement, plus the three-step catalogue import (choose a source, check what we found, drafts need proof). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 8 v2 screens SP-M25, SP-M26, SP-M27, SP-M28, SP-M29, SP-M34, SP-M35, SP-M36 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-203 — Seller customers, tax documents and badges

- **Depends on:** T-122, T-102, T-105, T-190
- **Model:** sonnet
- **Scope:** The customers list and a single customer, tax documents and tax details, my badges and what a badge means. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens SP-M37, SP-M38, SP-M39, SP-M40, SP-M41, SP-M42 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-204 — Account basics, money documents and system states

- **Depends on:** T-126, T-042, T-075, T-190
- **Model:** sonnet
- **Scope:** Saved addresses, add or edit an address, display and accessibility, receipt and documents, where's my refund, statements, and the six system states (service notice, update required, session expired, too many attempts, camera permission, link expired or trade not found). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 12 v2 screens SP-M14, SP-M15, SP-M16, SP-M17, SP-M18, SP-M19, SP-M01, SP-M02, SP-M33, SP-M11, SP-M12, SP-M13 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-205 — Account security and lifecycle

- **Depends on:** T-126, T-036, T-039, T-190
- **Model:** sonnet
- **Scope:** Privacy and data, security and devices, change phone number, account suspended (buyer and seller), verification failed, close your account and confirm closure, and two-factor setup with backup codes. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 10 v2 screens AS1, AS2, VF1, CA1, CA2, TF1, TF2, SP-M03, SP-M04, SP-M05 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-206 — Park agent hub tools and hub count

- **Depends on:** T-171, T-092, T-190, T-190
- **Model:** sonnet
- **Scope:** Scan a parcel, shift and hours, the commission statement, and the three-screen hub count (start, scanning, summary). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens SP-M30, SP-M31, SP-M32, SP-M43, SP-M44, SP-M45 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-207 — Desktop: arrive, home and discover

- **Depends on:** T-191, T-111, T-113, T-114, T-050, T-057, T-190
- **Model:** sonnet
- **Scope:** The desktop layouts of the first buyer and seller journeys: log in and verify identity, the three Home variants (Buyer, Merchant, New user), search results, browse categories, public seller profile, and find a trade by code. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 9 v2 screens DX-01, DX-02, DX-03, DX-04, DX-05, DX-06, DX-07, DX-08, DX-09 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-208 — Desktop: propose, agree and fund

- **Depends on:** T-191, T-192, T-193, T-194, T-117, T-190
- **Model:** sonnet
- **Scope:** Desktop create-a-trade (item and delivery, review and send, seller completes), seller reviews an offer, counter-proposal comparison, terms agreed, and the fund-and-protect screens (checkout, verifying, protected). Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 9 v2 screens DX-10, DX-11, DX-10B, DX-12, DX-13, DX-14, DX-15, DX-16, DX-17 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-209 — Desktop: fulfil, deliver, inspect and complete

- **Depends on:** T-191, T-116, T-118, T-122, T-123, T-124, T-195, T-190
- **Model:** sonnet
- **Scope:** Orders table with bulk actions, dispatch workspace, create listing with live preview, the trades workspace, Park pickup, inspect and compare, evidence across the trade, trade complete and review, and payouts and performance. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 9 v2 screens DX-18, DX-19, DX-20, DX-21, DX-22, DX-23, DX-38, DX-31, DX-32 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-210 — Desktop: issues and resolution, messages, trust and account

- **Depends on:** T-191, T-128, T-126, T-114, T-190
- **Model:** sonnet
- **Scope:** Messages with trade context, notifications centre, Trust Passport, and account and security. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 4 v2 screens DX-34, DX-35, DX-36, DX-37 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-211 — Desktop: help, documents and settings

- **Depends on:** T-191, T-129, T-204, T-190
- **Model:** sonnet
- **Scope:** Help and contact, statements and exports, address book, trade history and documents, shop profile and settings, shop team. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens SP-D01, SP-D02, SP-D03, SP-D04, SP-D05, SP-D06 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-212 — Tablet: arrive, home, discover, propose and fund

- **Depends on:** T-191, T-113, T-192, T-193, T-194, T-117, T-190
- **Model:** sonnet
- **Scope:** Tablet log in, Home (Buyer, Merchant, New user), search results, seller profile, create a trade, seller reviews an offer, terms agreed, and fund and protect. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 11 v2 screens TX-01, TX-02, TX-03, TX-04, TX-05, TX-06, TX-07, TX-07B, TX-08, TX-09, TX-10 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-213 — Tablet: fulfil, deliver, inspect and payouts

- **Depends on:** T-191, T-195, T-118, T-123, T-124, T-190
- **Model:** sonnet
- **Scope:** Tablet orders, dispatch workspace, trade workspace, inspect and compare, evidence across the trade, and payouts and performance. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens TX-11, TX-12, TX-13, TX-14, TX-22, TX-19 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-214 — Tablet: issues, messages, account and help

- **Depends on:** T-191, T-128, T-126, T-129, T-190
- **Model:** sonnet
- **Scope:** Tablet messages, account, help and contact, statements and shop settings. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 5 v2 screens TX-20, TX-21, SP-T01, SP-T02, SP-T03 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-215 — TrustOps: operations control, knowledge and quality

- **Depends on:** T-141, T-101, T-104, T-190
- **Model:** sonnet
- **Scope:** Incident command, provider and partner health, shift handover, the knowledge base and playbooks, and quality and calibration. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 5 v2 screens OP-46, OP-47, OP-48, OP-53, OP-54 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-216 — TrustOps: governance

- **Depends on:** T-141, T-104, T-048, T-190
- **Model:** sonnet
- **Scope:** Policy change request, retention and legal holds, break-glass access, and Trust Event correction. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 4 v2 screens OP-55, OP-56, OP-57, OP-58 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-217 — TrustOps: treasury and communications

- **Depends on:** T-141, T-076, T-045, T-190
- **Model:** sonnet
- **Scope:** Message templates, announcements, and treasury and float. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 3 v2 screens OP-62, OP-63, OP-64 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-218 — TrustOps: field audits

- **Depends on:** T-141, T-148, T-104, T-190
- **Model:** sonnet
- **Scope:** The four-step hub audit on a phone (start, checklist, add a finding, summary and sign-off) and audit results and follow-ups. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 5 v2 screens AU-1, AU-2, AU-3, AU-4, OP-72 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-219 — TrustOps: people development

- **Depends on:** T-140, T-037, T-190
- **Model:** sonnet
- **Scope:** Training and certification, module and assessment, and the certification matrix. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 3 v2 screens OP-73, OP-74, OP-75 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-220 — TrustOps: tablet

- **Depends on:** T-141, T-142, T-143, T-147, T-150, T-190
- **Model:** sonnet
- **Scope:** The touch layouts for reviewers and approvers: Today, My work, proposal review, dispute decision, hub application and approvals. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 6 v2 screens OP-T1, OP-T2, OP-T3, OP-T4, OP-T5, OP-T6 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-221 — Desktop and tablet: issues and resolution

- **Depends on:** T-191, T-120, T-196, T-199, T-200, T-190
- **Model:** sonnet
- **Scope:** The desktop and tablet layouts of the dispute journey: report an issue, case status and evidence, decision, return status, check the return, settlement negotiation and appeal. Split out of T-210 and T-214 on 2026-11-06, when the owner put buyer and seller disputes in the MVP. Definition of done as epic 13 (frontend-design per screen, ui-kit only, all states, e2e and axe).
- **Acceptance criteria:** the 11 v2 screens DX-24, DX-25, DX-26, DX-27, DX-28, DX-29, DX-30, TX-15, TX-16, TX-17, TX-18 are built to the reference rows in `SCREEN_INDEX.md`, with copy taken from the reference and every data-backed screen showing loading, empty, error and offline states.

### T-222 — Re-base TabBar to v2 mobile styling

- **Depends on:** T-191
- **Model:** sonnet
- **Scope:** `TabBar` still draws T-110's v1 mobile styling and is parity-tested against the v1 stylesheet, so T-191 changed only its five items. Re-base it and its parity tests on v2's `.komtru-mobile-nav`. Found in the T-191 review (`docs/ui-review/T-191/README.md`).
- **Acceptance criteria:** the mobile tab bar matches the v2 mobile tab-bar styling at `Komtru — UI Living Master v2.html` line ~7481: an indigo-soft pill behind the active item, 20px icons and 10px labels, with v2's blur and shadow; the `TabBar` parity tests assert v2's values rather than v1's; axe stays clean at four widths.
