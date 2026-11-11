# F-027 — Confirm delivery, inspect, complete and release (T-118)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the production build and a canned
stand-in for the platform (trade ids mapped to states; one proxy adds the sealed session cookie).

| Screen     | Route                 | Trade state                      | Differing pixels |
| ---------- | --------------------- | -------------------------------- | ---------------- |
| Z4         | `/trade/[id]/inspect` | `INSPECTION`, buyer              | 10.02%           |
| Customer-4 | `/trade/[id]/inspect` | `INSPECTION`, buyer              | 9.94%            |
| BEI2       | `/trade/[id]/inspect` | `INSPECTION`, seller, asked      | 14.66%           |
| DE1        | `/trade/[id]/extend`  | `FUNDED`, seller                 | 12.58%           |
| DE2        | `/trade/[id]`         | `FUNDED`, buyer, request waiting | 10.30%           |
| DE3        | `/trade/[id]`         | `FUNDED`, buyer, date passed     | 10.06%           |
| AB1        | `/trade/[id]`         | `SHIPPED`, buyer                 | 9.76%            |

**Sheets, shot by hand** (the harness takes a URL, not a click): Z5 (confirm and release, acknowledgement ticked)
and BEI1 (ask for more time) at 340 x 660. Both rise over the tab bar with their actions reachable. The first shot
found the tab bar covering the sheet's Cancel button (both are z-20 in the kit, pinned to the reference); fixed in
the app by lifting the sheet in a z-30 wrapper (`OverTabBar`), which also fixes the existing withdraw sheet.

**Not built, on purpose:** AB2 (pickup PIN) and the Park fee notice (Park is F-062, dropped for MVP), MI4
(multi-item inspection, F-080), "Report an issue" (disputes, F-032), DE3's refund button (F-030). Each screen's file
says why.

## Judgement

**Pass, with the deviations accepted.** Structure, order and copy follow the reference. The 10% to 15% scores are the
shell and sticky footer (the reference draws neither), the deliberate MVP cuts, and the stand-in's data, not spacing,
colour or type errors against the design system. BEI2 scores highest because the reference draws a different layout
(the ask inside a proposal, with a counter) from the one the platform's inspection extension allows.
