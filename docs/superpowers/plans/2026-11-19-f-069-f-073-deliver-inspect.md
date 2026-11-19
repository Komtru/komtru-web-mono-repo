# F-069 / F-073 — Deliver & inspect at desktop and tablet widths

Half of T-209 and T-213: the screens DX-21, DX-23, DX-38 (desktop) and TX-13, TX-14, TX-22 (tablet). DX-22 (Park
pickup) is not built (see below). The other half (fulfil and dispatch, complete and grow) is another branch.

This is a layout pass over mobile flows that are Done (F-022 workspace, F-027 inspect, F-028 delivery evidence). No
new data, no backend change, no migration. Every hook and component is reused; what is new is arrangement.

## Breakpoints

Follow F-068/F-072: `md` = 768 is tablet, `lg` = 1024 is desktop, base is the phone and does not change.

## One new primitive, in `src/trade/workspace/`

- `viewport.ts` — `useViewport()` returns `'mobile' | 'tablet' | 'desktop'` from `matchMedia`. With no `matchMedia`
  (jsdom, the server) it is `'mobile'`, so every existing suite keeps drawing the phone screen.
- `layout.tsx` — `TradeColumn` (the 480 / `md` 760 / `lg` unbounded column `ProposeWorkspace` uses) and `Panel` (the
  reference's `.dweb-panel`: a hairline card with an `h4`).

Why a hook and not CSS only, as `ProposeWorkspace` does: the wide workspace adds a **read** (the trade list, for the
left pane) and a second copy of the money rows. A phone must not make that read, and jsdom (every existing
workspace and dispute suite) must not see duplicate rows. A viewport hook keeps both out of the phone tree.

## Screens

### DX-21 / TX-13 Trade workspace (`workspace/Workspace.tsx`)

- Exists: header, `TradeRow` hero, tabs, one body per status.
- Tablet (`md`): the trade list as a narrow pane (`useTradeList`, the rows `MyTrades` draws, current one marked,
  Active / Needs action / Completed filter), beside the detail. The detail is the existing header, hero, tabs and
  body, plus a five-stage timeline. The context panels (Money, Evidence) stack under the detail.
- Desktop (`lg`): list | detail | context rail (Money, Evidence preview with "View all").
- The state bodies' own `MoneyRows` are suppressed while the rail shows them (a context flag), so no figure is
  drawn twice.
- Tests: the wide layout is asserted with a mocked `matchMedia`; the phone suite is untouched.

### DX-23 / TX-14 Inspect & compare (`inspection/Inspect.tsx`, `proof/ProofReview.tsx`)

- Exists: window, seller's proof / my photos pills, delivery record, checks, actions, release and more-time sheets.
- Tablet: pills stay (the reference's segmented control); content is two columns, compare on the left, checks and the
  action bar in a sticky right column.
- Desktop: the pills go; "What the seller showed" and "What you received" sit side by side, checks and actions under.
- Tests: `InspectCompare` shows both panels at desktop, one at tablet; actions stay reachable.

### DX-38 / TX-22 Evidence across the Trade (`delivery/Evidence.tsx`, `proof/EvidenceStates.tsx`)

- Exists: `Trail` (seller's proof, dispatch, delivery, inspection, issue groups) and `TradeRecord`.
- Desktop: three panels, Before you accept / During the Trade / After it's complete. Tablet: the same three behind a
  segmented control, one at a time.
- Not drawn because the platform has no such data (the same rule `EvidenceTrail` already states): "kept for 12
  months", the hub scan, "Download a copy", and "Seller can still change it" (a Trade past agreement cannot).

### DX-22 Park pickup — not built

Park handover (F-062) does not exist, so there is no PIN, hub or custody event to draw, and the existing
`/trade/[id]/pickup` is the self-arranged "Delivery details" sheet. Drawing the desktop reference would be faking
data. Skipped, and recorded in `docs/ui-review/T-209/DX-22.md`.

## Test plan

Vitest + Testing Library, each suite ends in an axe check: `viewport`, `workspace-wide`, `inspect-wide`,
`evidence-wide`. Existing `workspace`, `inspect`, `delivery-*`, `proof-*` and dispute suites must stay green unchanged.

## Visual check

Walks added to `tools/visual-check/src/walkthroughs.ts` (appended, commented `F-069/F-073 deliver & inspect`) and
fixtures to the stand-in for a shipped buyer trade, an inspection trade and a trade's evidence. Each screen is
captured at 768 and 1232 against the stand-in, and loaded once in `next start` on 3201. Notes go in
`docs/ui-review/T-209/` and `docs/ui-review/T-213/`.
