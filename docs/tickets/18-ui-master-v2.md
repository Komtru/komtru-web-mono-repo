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

### T-191 — Placeholder: tickets created by T-190

- **Depends on:** T-190
- **Acceptance criteria:** T-190 replaces this heading with the real tickets it creates.
