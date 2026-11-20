# Customer-7 — Report an Issue (T-120)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4140 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000503/dispute
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,393 of 224,400 (9.98%)
- **Side by side:** `Customer-7.png` (reference · built · heat map) — **heat map:** `Customer-7.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `with-trades`, buyer, the trade in inspection (`/trade/<id>/dispute`, no case yet). The screen renders in full, no error state.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Reason list.** Four options, but a different four: the built list is DI-01's canonical set (Arrived damaged, Not as described, Item or parts missing, Other concern); the reference says "Item doesn't match description / never arrived / arrived damaged / Something else". Intended and argued in the README (four vocabularies, one enum). Parked for the owner.
- **Nothing pre-selected.** The reference marks the first reason; the built form keeps the button disabled until a reason is picked. Intended.
- **Header copy and amount.** "Your ₦64,000 stays protected..." against "₦452,000" (fixture data). Built adds a Trade / Amount / Funds term list that the reference only draws on CWT-S14.
- **Photos.** The reference draws an "Add evidence photos" drop zone under "Tell us what happened". The built form has the description and no uploader. **Real gap, not changed:** `POST /trades/:id/dispute` takes a category and a reason and no files, so photos can only follow through `POST /disputes/:id/evidence` (which takes a `fileRefId`). The upload path exists (`uploadFile`, `FileDropzone`) but wiring it needs the processing retries and error states `AddEvidence` has. See the README's Judgement.
