# SP-M12 — Where’s my refund? (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 8050 — Supporting · Money & documents
- **Built:** http://localhost:3146/account/refunds
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 9,575 of 224,400 (4.27%)
- **Side by side:** `SP-M12.png` (reference · built · heat map) — **heat map:** `SP-M12.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **Built over `GET /me/refunds` and nothing else.** That is the buyer's own refund list: amount, status, the dates the ledger recorded, a failure reason, and the fee treatment. It is one screen of every refund, newest first, not the reference's one refund for one Trade.
- **The journey is the ledger's.** Refund requested (dated) → On its way back → Back with you (dated when `PROCESSED`); a held refund (`FAILED` or `NEEDS_REVIEW`) says **Held while we check it**, says why (the platform's `failureReason`) and says to quote the reference. A refund still moving is never said to have arrived.
- **Not drawn, because the platform records none of it:** the return handover ("You handed it in · Wuse II hub"), the seller's check ("Due in 2 days"), the destination bank ("To GTBank •••• 1234") and "Usually within 1 day". The destination is said as the platform says it, "your original payment method", and no arrival time is given.
- The reference's footer ("Your money stays protected until the seller confirms the item is back") is replaced by a note that refunds go back to the payment method paid with and that the bank's own time after that is not ours to state.
- **Empty is honest.** With no refund the screen says "No refunds" and what makes one appear; it does not describe cancelling or returning as if it were a feature of this page.
- The list is polled while a refund is on its way back and stops once settled (`useMyRefunds`).
- Shot with one refund `PROCESSING`. Loading, empty, error, offline, held, a retained fee and a finished refund are held by `test/refunds-screen.test.tsx`, each with an axe pass.
- The poll backs off (5s, 10s, 20s, 40s, then once a minute) and stops after about half an hour (`refundPollDelay`): a refund can sit `PROCESSING` for days, and every ask re-reads every loaded page of the list. Coming back to the screen starts the count again.
