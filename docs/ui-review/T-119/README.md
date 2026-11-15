# F-030 — Cancel a trade and get a refund (T-119)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the production build and a canned
stand-in for the platform (trade ids mapped to states; one proxy adds the sealed session cookie).

| Screen | Route                        | Trade state                               | Differing pixels |
| ------ | ---------------------------- | ----------------------------------------- | ---------------- |
| CT1    | `/trade/[id]/cancel`         | `PENDING_PAYMENT`, buyer, no payment      | 61.81%           |
| CT2    | `/trade/[id]`                | `CANCELLED`, buyer                        | 2.99%            |
| AR1    | `/trade/[id]`                | `SETTLED`, buyer, inspection auto-elapsed | 10.20%           |
| CR1    | `/trade/[id]/cancel`         | `FUNDED`, buyer, `canRequest`             | 9.93%            |
| CR2    | `/trade/[id]/cancel-request` | `FUNDED`, seller, request pending         | 14.49%           |
| CR3    | `/trade/[id]`                | `CANCELLED_REFUNDED`, buyer, `PROCESSED`  | 4.07%            |
| SC1    | `/trade/[id]/cancel`         | `FUNDED`, seller, `canCancelAsSeller`     | 12.96%           |
| SC2    | `/trade/[id]`                | `CANCELLED_REFUNDED`, buyer, seller's     | 8.63%            |

CT1 scores high because the reference draws a bottom sheet over a faded screen and the built screen is a route of
its own. Every other score is the shell, the sticky footer the reference pins and the app does not, and the
deliberate deviations listed in each screen's file.

**States shot by hand, not by the harness** (no reference frame; PNGs are not committed): CT1 with a payment attempt
open (cancel held behind the "I haven't sent any money" tick), CT1 with a payment verifying (no cancel offered), CR3
with the refund processing, held (`FAILED`, with the platform's reason and the reference) and with no refund row, and a
funded trade with a refund requested. Each is also a unit test.

**The money rule these screens follow.** A screen never asserts a financial state it has not read for that trade. Refund
amounts and the fee treatment are the refund row's, as sent. "Issued" is said only of a `PROCESSED` refund. CT1 does not
say "no money has moved": it reads the buyer's payment status and offers nothing while a payment may be on its way.
Approving a cancellation and the seller's can't-fulfil ask once. The deviations name every reference promise that is
not built (12-hour auto-approval, TrustOps hold on contest, "arrives within 2 hours", the 24-hour auto-release
reopening window).

## Judgement

**Pass, with the deviations accepted.** Structure, order and copy follow the reference wherever the platform backs the
words. The differences are the shell, CT1's route-not-sheet, and the promises the platform does not make.
