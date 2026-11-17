# SP-M13 — Statements (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 8070 — Supporting · Money & documents
- **Built:** http://localhost:3146/account/statements
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,448 of 224,400 (9.56%)
- **Side by side:** `SP-M13.png` (reference · built · heat map) — **heat map:** `SP-M13.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **There is no statement service**, so the file is made in the browser from the two lists the platform returns, `GET /me/payouts` and `GET /me/refunds`, for the period chosen. It holds those and the screen says so.
- **CSV only.** The reference offers PDF and CSV. Nothing here can make a PDF that means more than the lists it came from, so Format is a single fixed row, CSV, which opens in Excel and Sheets. The file has a byte-order mark so Excel reads it as UTF-8, and a text cell that a spreadsheet would run as a formula is defused with a leading apostrophe.
- **Includes: Payouts and Refunds**, two tick boxes. The reference's "Trades and payments" is not offered: the platform has no list of a person's payments for Trades to build from, and the note under the form says so and points to a Trade's documents for its receipt. "Fees" is not a switch: the payout fee and the buyer protection fee are columns of every row.
- **Period** is This month, Last 3 months (this month and the two before it) or Custom dates, in Lagos days; a custom range back to front says so and holds Export.
- A period with nothing in it says "Nothing moved in this period" and saves no file.
- Money is each kobo amount written out as naira with two decimals; none is summed.
- Shot at the first state, before any export. Preparing, a failed export, offline, a period with nothing, every period, and the file itself (read back byte for byte) are held by `test/statement.test.ts` and `test/statements-screen.test.tsx`, each state with an axe pass. The only stand-in is the browser's "save a file", which jsdom cannot do.
- The file name and the date inputs' latest day use the **Lagos** day (not UTC), so between 00:00 and 01:00 Lagos the file is dated today and today can be chosen. The download's address is released a second after the click, not at once, because older Safari and Firefox start the download after the click returns.
