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
