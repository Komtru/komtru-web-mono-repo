# SP-M01 — Saved addresses (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7845 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/addresses
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,170 of 224,400 (13.89%)
- **Side by side:** `SP-M01.png` (reference · built · heat map) — **heat map:** `SP-M01.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **"Default · used for courier cost" is now "Default · chosen first on a new Trade"**, and the banner under the list is reworded the same way. The platform does no courier-cost estimate from an address; what the default does is the address the trade screens choose first (`AddressPicker`). The reference's promise would have been false.
- The row shows the platform's fields (street, city, state, then the recipient's number written the way it is dialled), not the reference's "Lekki Phase 1, Admiralty Way, Lagos". The landmark is on the edit screen, not in the list.
- Added **Edit**, **Make <label> the default** and **Remove <label>** under each row. The reference draws no controls for them. Remove opens the ui-kit confirm sheet and says it archives the address and that Trades already agreed keep the address they were agreed with (the platform archives; it never deletes, because a trade snapshots the address).
- Added a warning for an address whose city has left the catalog (`cityActive: false`): it cannot take a new Trade until another city is chosen.
- The platform keeps at most 20 live addresses; at 20 **Add an address** is replaced by a sentence saying so.
- The back control and title are `ScreenHeader` (title centred), not the reference's title at the right.
- Shot with two addresses. Loading, empty, error, offline, the cap, and every failed change are held by `test/addresses.test.tsx`, each with an axe pass.
