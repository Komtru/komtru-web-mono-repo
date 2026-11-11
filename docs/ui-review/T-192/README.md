# F-018 — Create a trade: buyer starts, seller completes (T-192)

Shot with a script that walks the real screens in a browser (typing, pressing Continue, attaching photos), against the
**v2 master**, with the built page clipped from `main` and a canned stand-in for the platform routes and a sealed session
cookie. The harness's `visual-check` takes a URL only, so a multi-stage form's later stages could not be reached by it;
the script reused its reference carving, fonts and pixel diff. CT-B2P was shot with the Park switch temporarily on
(Park delivery is deferred for MVP); the patch was reverted.

| Screen | Route                  | State                              | Differing pixels |
| ------ | ---------------------- | ---------------------------------- | ---------------- |
| CT-B1  | `/trade/new`           | seller found, item and price typed | 10.55%           |
| CT-B2  | `/trade/new` (stage 2) | Courier                            | 11.74%           |
| CT-B2P | `/trade/new` (stage 2) | Park, Park switch on               | 11.38%           |
| CT-B3  | `/trade/new` (stage 3) | Komtru terms                       | 12.10%           |
| CT-B4  | `/trade/new` (stage 4) | review, seller's part waiting      | 10.34%           |
| CT-B5  | `/trade/new` (sent)    | sent                               | 7.55%            |
| CT-B6  | `/trade/<id>`          | seller's request                   | 12.17%           |
| CT-B7  | `/trade/<id>/complete` | item details                       | 9.02%            |
| CT-B8  | `/trade/<id>/complete` | delivery, Courier                  | 10.23%           |
| CT-B8P | `/trade/<id>/complete` | delivery, Park request             | 11.02%           |
| CT-B9  | `/trade/<id>/complete` | confirm and send                   | 10.49%           |
| CT-B10 | `/trade/<id>`          | buyer reviews and accepts          | 10.03%           |

## Judgement

**Pass, with the deviations accepted.** Order, copy, components (stage rail, item card, ticked term rows, the Trade Code
card, the timeline) follow the reference. The scores come from the shell (header and tab bar where the reference draws its
own bar and a pinned footer), from fields the platform's data asks for in place of the reference's fixed ones, and from
three things the platform cannot yet say, none of which is drawn as fact: the seller's delivery charge in the total,
approved delivery partners, and Park. See each screen's deviations.
