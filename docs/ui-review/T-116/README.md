# F-022 — Follow a trade in one role-aware workspace (T-116)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the real app and a canned
stand-in for the platform (trade ids mapped to states; one proxy adds the sealed session cookie). The data is
illustrative; copy and layout are the real screens.

| Screen     | Route                                         | Seen as | Differing pixels |
| ---------- | --------------------------------------------- | ------- | ---------------- |
| CWT-01     | `/trade/[id]` (`PENDING_PAYMENT`)             | buyer   | 9.84%            |
| CWT-02     | `/trade/[id]` (`FUNDED`)                      | seller  | 10.23%           |
| CWT-03     | `/trade/[id]` (`SHIPPED`)                     | buyer   | 9.77%            |
| CWT-04     | `/trade/[id]` (`INSPECTION`)                  | buyer   | 10.01%           |
| CWT-05     | `/trade/[id]` (`DISPUTED`)                    | buyer   | 10.78%           |
| CWT-06     | `/trade/[id]` (`COMPLETED`)                   | seller  | 11.17%           |
| CWT-07     | `/trade/[id]/terms`                           | seller  | 10.39%           |
| CWT-08     | `/trade/[id]/activity`                        | buyer   | 11.25%           |
| CWT-09     | `/trade/[id]/actions`                         | buyer   | 10.24%           |
| Customer-3 | `/trade/[id]` (`FUNDED`, buyer; see its note) | buyer   | 5.73%            |
| Customer-5 | `/trade/[id]` (`SETTLED`)                     | buyer   | 8.48%            |

CWT-01 to CWT-06 are one surface in six states, not six screens, and CWT-07 to CWT-09 are its tabs; they are
the same component (`Workspace`) rendered by `TradeScreen` for every status from the agreement onward. The
roles in the table are only which side the stand-in trade put the reader on: the same screen draws the other
side from `yourRole` (the suite renders every state for both).

## How to read the percentages

About ten percent differing is the same band as F-017's screens, and it is mostly not content. Most of every
frame is white either way, and a few shared things always light the heat map: the top bar (the reference draws
its own, the built screen is inside the app shell and starts at its content), the tab bar at the foot of the
compared area, and the pinned two-button footer the reference draws where the built screen puts actions in the
page flow. Read the heat maps for what each screen says, and each `.md` for the list.

## Differences, sorted

**Correctly shows less, because the feature is post-MVP or belongs to a later feature** (no dead button is
drawn for any of these; each screen says plainly what is not in the app yet):

- Funding (F-024): "Fund this trade", the trade expiry, the payment rows.
- Shipping (F-026): "Prepare & dispatch", the dispatch method and route.
- Delivery tracking (T-087, T-093): courier partner, last update, next step. Only the waybill the platform
  records is shown.
- Inspection (F-027): "Inspect & compare", "Report an issue", more time.
- Disputes (F-032): case reference, stage, exposure, evidence timer, "Submit evidence".
- Reviews (F-038) and the Trust Profile count (F-016); messaging (F-044), the chat icon and "Message ...".
- Policy copy with no API source: "Cancellation & issue terms", "Policy minimum".

**Real differences, intended** (a decision, with the reason in the screen's `.md`):

- A **tab strip** (Overview, Terms, Activity, Actions) on every workspace screen; the reference reaches those
  views from buttons, one set per state.
- CWT-01 keeps **F-017's "Terms agreed" body** (its tests are binding) instead of the "Protect the agreed
  amount" banner. This is the largest visible difference.
- Deadlines read "Ship by · 1 Oct · 18:00" and "Inspection ends · 2 Oct · 13:24" (the platform's date, in Lagos
  time) instead of a running "remaining" count.
- The activity feed is labels, who and when, newest first, paged; it carries no amounts or free text by design.
- Customer-3 has no separate drawing in the built app: it is the buyer's `FUNDED` workspace.
- Customer-5 keeps the summary card and tabs above the celebration.

**Real mismatches left open:** none that is a defect. Two are judgement calls the owner may want redrawn: the
CWT-01 hero above, and whether Customer-5 should hide the card and tabs for its full-screen moment.
