# F-019 — Create a trade: seller starts, buyer completes (T-193)

Shot by walking the real screens in a browser (typing, pressing Continue, attaching photos) against the **v2 master**,
with the built page clipped from `main` and a canned stand-in for the platform routes and a sealed session cookie. The
shots were taken after the last source commit (`fb38534`); the pixel scores for CT-S1, CT-S2F, CT-S6 and CT-S7 were
counted from their saved heat maps (the count reproduces the script's figures for CT-S2 to CT-S5 exactly). Park delivery
is deferred for MVP, so Park is "Coming soon" on both sides of this flow.

| Screen | Route                    | State                                            | Differing pixels | Content only |
| ------ | ------------------------ | ------------------------------------------------ | ---------------- | ------------ |
| CT-S1  | `/trade/new (Sell mode)` | stage 1, buyer found, item and price typed       | 10.99%           | 4.42%        |
| CT-S2  | `/trade/new (Sell mode)` | stage 2, Electronics                             | 10.31%           | 3.42%        |
| CT-S2F | `/trade/new (Sell mode)` | stage 2, Fashion & Luxury                        | 10.41%           | 3.95%        |
| CT-S3  | `/trade/new (Sell mode)` | stage 3, Courier                                 | 11.71%           | 4.94%        |
| CT-S4  | `/trade/new (Sell mode)` | stage 4, review, buyer's delivery choice waiting | 10.27%           | 3.71%        |
| CT-S5  | `/trade/new (sent)`      | sent                                             | 19.88%           | 18.66%       |
| CT-S6  | `/trade/<id> (buyer)`    | buyer chooses, Courier selected                  | 11.08%           | 5.04%        |
| CT-S7  | `/trade/<id> (buyer)`    | buyer reviews and accepts                        | 9.77%            | 3.99%        |

## Judgement

**Pass, with the deviations accepted.** Order, copy and components (stage rail, item card, ticked term rows, the Trade
Code card, the timeline, the choose-delivery cards) follow the reference. Content-only scores are 3.4% to 5.0% for
every screen except CT-S5, whose 18.7% is a uniform 60px offset (the sent page has no stage rail and the shot starts
below the app header); the screen's order and copy match. What remains elsewhere is text that wraps differently because
the platform's fields and data replace the reference's fixed examples, and the shell (header, tab bar and in-flow
actions where the reference draws its own bar and pinned footer). Nothing the platform cannot yet say is drawn as fact:
buyer address on the seller's side, approved delivery partners, and Park.
