# F-037 — Get paid out (T-124)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the real production build and a
canned stand-in for the payout routes (one proxy adds the sealed session cookie).

| Screen   | Route                       | State                      | Differing pixels |
| -------- | --------------------------- | -------------------------- | ---------------- |
| Seller-6 | `/account/payouts`          | ₦1,200,000 available       | 7.87%            |
| AB5      | `/account/payouts/withdraw` | one verified account       | 14.16%           |
| AB6      | `/account/payouts/bank`     | one verified default       | 14.21%           |
| WF1      | `/account/payouts/<id>`     | payout `FAILED`            | 14.36%           |
| PR1      | `/account/payouts/<id>`     | payout `SUCCEEDED`, manual | 3.81%            |

## Judgement

**Pass, with the deviations accepted.** Structure, order and components follow the reference (balance card, quick
amounts, bank rows, info banners, term rows, the WF1 hero). The scores are driven by three things the check cannot
discount: the shell (header and tab bar where the reference draws its own bar and a sticky footer), copy changed so as
not to state money rules the platform does not have (AB5's arrival and fee promise, AB6's business-name match), and
additions the platform's data asks for (AB6's account list, PR1's fee rows, Seller-6's account and schedule lines).
Nothing flagged is a spacing, colour or type error against the design system. See each screen's deviations.
