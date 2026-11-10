# F-024 — Fund escrow (T-117)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the real app and a canned
stand-in for the platform (trade ids mapped to payment states; one proxy adds the sealed session cookie). The
data is illustrative; copy and layout are the real screens.

| Screen | Route                           | Payment state   | Differing pixels |
| ------ | ------------------------------- | --------------- | ---------------- |
| V1     | `/trade/[id]/fund`              | `NONE`          | 13.44%           |
| V2     | `/trade/[id]/fund?via=transfer` | `NONE`          | 23.70%           |
| V3     | `/trade/[id]/fund`              | `CONFIRMED`     | 2.77%            |
| AB3    | `/trade/[id]/fund`              | `VERIFYING`     | 2.39%            |
| AB4    | `/trade/[id]/fund`              | `NOT_CONFIRMED` | 23.14%           |

All five are one screen (`FundTrade`), whose step is the platform's payment display state (T-072), not the
screen's own memory. Only V1 → V2 is local, because choosing a method costs nothing on the server.

## Differences, sorted

**Pre-approved (design §5):** no "Logistics fee" line (C7, Q5); V2 is Paystack pay-with-transfer, so the
one-time account number is shown in Paystack's checkout, not drawn by the app (C8, Q6). V2 and AB4 carry most
of their percentage for this reason: the midnight account card is the largest block on both drawings.

**Correctly shows less:** no Komtru Wallet option (Q3, F-025); no "get help" or "contact support" buttons
(support is F-047, AB4 prints the trade code to quote instead).

**Real differences, intended:** no "(1.5%)" on the fee line (the rate is not on the wire, and the app does not
work one out); no "NDIC-insured" claim (no spec states it); AB3 and AB4 speak of "payment" and "Paystack"
because they also serve card and USSD; AB4 does not promise "nothing has been charged" for a transfer that may
still land.

**Not drawn by the reference at all:** `UNDER_REVIEW` (money arrived that did not match the attempt) is a plain
"We're checking this payment — you don't need to pay again" screen. Owner may want it drawn.
