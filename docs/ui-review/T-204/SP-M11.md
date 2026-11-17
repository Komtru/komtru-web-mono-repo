# SP-M11 — Receipt & documents (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 8028 — Supporting · Money & documents
- **Built:** http://localhost:3146/trade/0190b0a0-0000-7000-8000-000000000001/documents
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 20,114 of 224,400 (8.96%)
- **Side by side:** `SP-M11.png` (reference · built · heat map) — **heat map:** `SP-M11.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **No PDFs.** The reference lists "Agreement (PDF)" and "Receipt (PDF)" with **Download all** and **Share**. The platform makes no PDF documents and has no sharing. So: **Agreement** opens the Trade's own agreement screen; **Receipt** is drawn on the page from the Trade's fee snapshot with **Print or save as PDF** (the browser makes the PDF; the app's navigation is hidden for print); **Download all** and **Share** are not drawn.
- **The receipt figures are the platform's snapshot** (`fees`), as sent: for the buyer the item, the buyer protection fee and **You paid**; for the seller the item, Komtru's fee only if it is not zero, and **You receive**. Nothing is added up on the page. The reference's "₦461,280 paid · fee ₦6,780" is an illustration, not the platform's figures.
- **Delivery proof** reads "2 photos or videos · 1 delivery record", from the Trade's evidence, not the reference's "2 photos · hub scan · 6 Oct": the platform records no hub scan on a trade yet. It opens the Trade Record.
- **"Documents are kept with the Trade for 12 months" is dropped.** The platform states no retention period, so none is promised.
- Added the status chip (Completed, or Refund decided), the Trade Code, and for a refund decision a pointer to Where's my refund?.
- It is reached from the Trade Record ("Receipt & documents"). Documents are there only once the Trade is complete, as the reference says; before that the screen says so and links the agreement.
- Shot at a settled Trade as the buyer. Loading, the Trade not being there (SP-M19), a failed delivery-proof read (the receipt stays), offline, a Trade with no fee snapshot, and the refund note are held by `test/trade-documents.test.tsx`, each with an axe pass.
