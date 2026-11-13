# F-023 — Terms, agreement and payment detail in the workspace (T-194)

Shot by walking the real screens in Chromium against `next dev` and the **v2 master** (`pnpm visual-check`'s own carving,
shooting and scoring, driven by a script so the platform's routes could be answered from canned data and a sealed session
cookie set). The screens that need a state the harness cannot reach by URL were reached the way a person would: CWT-S04 by
choosing a method and pressing "Continue to payment". Pixel scores are the harness's, with the shot starting at `main`; the
built screens sit inside the app shell and the reference does not, so every score carries the shell and its offset (see each
file's first deviation). Content-only scores were not computed.

| Screen  | Route                           | State shot                          | Differing pixels |
| ------- | ------------------------------- | ----------------------------------- | ---------------- |
| TW-01   | `/trade/<id>` (buyer)           | agreed, awaiting funding            | 10.36%           |
| TW-02   | `/trade/<id>/fulfilment`        | accepted fulfilment terms           | 10.29%           |
| TW-03   | `/trade/<id>/fund`              | payment started, not completed      | 10.47%           |
| TW-04   | `/trade/<id>/policies`          | policies                            | 15.62%           |
| EX-01   | `/trade/<id>` (buyer)           | agreed trade, expired unfunded      | 15.35%           |
| CWT-S01 | `/trade/<id>/agreement`         | accepted terms                      | 11.62%           |
| CWT-S02 | `/trade/<id>/agreement/history` | version history                     | 14.25%           |
| CWT-S03 | `/trade/<id>/fund`              | no payment yet, choose a method     | 8.48%            |
| CWT-S04 | `/trade/<id>/fund`              | after "Continue to payment": review | 14.71%           |
| CWT-S05 | `/trade/<id>/fund`              | platform is verifying               | 14.93%           |
| CWT-S06 | `/trade/<id>/fund` (funded)     | funds protected                     | 8.22%            |
| CWT-S07 | `/trade/<id>/fund`              | not confirmed                       | 9.50%            |

## Judgement

**Pass, with the deviations accepted.** Order, copy and components follow the reference on every screen. What differs is the
shell (header, tab bar and in-flow actions where the reference draws its own bar and pinned footer), amounts printed with
kobo, and four things the platform cannot yet say, none of which is drawn as fact: a funding deadline or "six hours"
(owner question O1), earlier agreement versions' amounts and proposers (O2), a saved card or wallet, and editable terms
after acceptance. The payment states are drawn in place on F-024's one address rather than on the reference's
`/fund/review`, `/fund/processing` and `/fund/failed`, because the step is the platform's payment state.
