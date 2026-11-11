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

## Shell-masked re-run

Rows above 100px (the reference's own top bar; our header and stage rail) and the last 110px (the pinned footer; the
tab bar) were blanked on both sides and the diff re-taken. Content-only differing pixels, as a share of the whole frame:

| Screen | Content only | Screen | Content only |
| ------ | ------------ | ------ | ------------ |
| CT-B1  | 3.79%        | CT-B6  | 6.42%        |
| CT-B2  | 5.01%        | CT-B7  | 3.29%        |
| CT-B3  | 5.24%        | CT-B8  | 3.96%        |
| CT-B4  | 3.83%        | CT-B8P | 3.45%        |
| CT-B5  | 6.63%        | CT-B9  | 4.16%        |
| CT-B10 | 3.69%        |        |              |

**Not at 2%, and not drift.** What remains is text: the reference's copy and fields differ from the platform's data by
design (the category's own item fields, a typed partner and charge, the platform's Trade Code, no "98.7% fulfilment"
or expiry line), and every line of text that wraps differently shifts all those below it. Spacing, type and colour
follow the kit's tokens. The deviations are listed per screen.
