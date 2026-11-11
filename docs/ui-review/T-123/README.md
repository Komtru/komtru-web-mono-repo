# F-026 — Seller fulfilment (T-123)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the real production build and a
canned stand-in for the platform (trade ids mapped to states; one proxy adds the sealed session cookie).

| Screen   | Route              | Trade state       | Differing pixels |
| -------- | ------------------ | ----------------- | ---------------- |
| X1       | `/trade/[id]/ship` | `PENDING_PAYMENT` | 13.16%           |
| X2       | `/trade/[id]/ship` | `FUNDED`          | 9.30%            |
| Seller-3 | `/trade/[id]/ship` | `FUNDED`          | 8.64%            |
| AC8      | `/orders`          | open trades       | 4.11%            |

**Built earlier, by F-017, and not re-shot here:** Seller-2 (new trade request), W1 (proof required), W2/W3 and BR1
(propose changes), SD1 (decline) are states of `TradeScreen` and `ProposeChange`; their checks are F-017's.

**Left out on purpose:** MI3 (multi-item ship, F-080), the Park waybill and handover OTP branch of X2 (F-062, F-066,
dropped for MVP). See each screen's deviations.

## Judgement

**Pass, with the deviations accepted.** The structure, the order of content and the copy of each screen match the
reference; the pixel scores (4% to 13%) are not a measure of a defect, because three things the check cannot
discount light up every heat map:

1. **The shell and the footer.** The built screen sits in the app shell (the reference draws none) and its actions
   sit in the page flow above the real tab bar, where the reference pins them in a sticky footer. That shifts the
   lower half of each screen and lights the tab bar.
2. **The deliberate MVP scope cuts.** X2 drops the logistics-method picker and Park (F-062, F-066 dropped); the
   reference's block of the largest cards is absent, so everything under it moves. AC8 reuses `TradeRow`, whose
   layout differs from the reference's.
3. **Illustrative data.** Names, codes, amounts and dates come from a canned stand-in for the platform, so the text
   differs from the drawing.

Nothing flagged is a spacing, colour or type error against the design system: the differing regions are text and
cards offset by the above. X1 scores highest (13.16%) because its three-step list is built from the shared timeline
component, which draws the nodes slightly larger than the reference's.
