# CWT-S13 — Evidence — Submit (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11091 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000001/evidence/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 18,539 of 224,400 (8.26%)
- **Side by side:** `CWT-S13.png` (reference · built · heat map) — **heat map:** `CWT-S13.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) below the form rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes and times are illustrative.

**Real differences (intended, and why)**

- **The reference's form, built (the seam is closed).** Copy, order and components follow the reference: the prose line, "Evidence category" as `OptionCard` rows, "Files" with the `FileDropzone` ("Add photos and video", "Stored with this trade"), "Submit evidence" and "Cancel". Upload first (`/files/upload-url`, storage, `/files/:id/finalize`), then `POST /trades/:id/evidence` with the file ids.
- **Dispatch is not offered to a buyer, and Inspection is not offered to a seller.** The reference lists all four for both sides. The platform enforces who adds what (dispatch is the seller's account of sending it, inspection the buyer's of receiving it; delivery and issue are either side's), so the screen offers only the events the person can use. The first allowed one is chosen, as the reference chooses Inspection.
- **Photos and PDF, not photos and video.** The reference says "Add photos and video". The platform stores JPEG, PNG, WebP and PDF only (the files module's `ALLOWED_CONTENT_TYPES`); video brings size, transcoding and free-tier quota decisions that are their own feature (owner decision, 2026-11-17). So the label reads "Add photos or PDFs", the picker accepts exactly those types, and a test checks the accepted set against the platform's own policy.
- **"Both" in the reference's header is narrowed per event** (owner decision, 2026-11-17): dispatch is the seller's own act and inspection the buyer's. Either side can add delivery and issue evidence, including a seller's rebuttal while the trade is under review.
- **Issue evidence is kept on the trade.** The table is append-only, so when the dispute flow lands, linking it to a case must go through a new link table, never an UPDATE of the evidence row.
- **Extra note under the files.** "Files stay private to this trade. Only you and the other side can see what is added." The reference is silent on who sees evidence; the platform grants the other party the files, so the screen says so.
- **Three empty slots, then the dropzone.** `FileDropzone` draws the slot grid above the dropzone; the reference draws only the dropzone. Added files show as tinted tiles named for the screen reader by file name (no local preview), with a remove control.
- **Stages other than shipped, delivered, inspection and under-review say so instead of drawing the form.** The platform answers 409 there; the reference draws no such state.
- **Success is a state on this screen** ("Evidence added", with View trade evidence and Back to trade) rather than a jump to CWT-S15, which belongs to the dispute flow and is not built.
- **Heat map.** The remaining difference is vertical offset from the shorter heading block, the slightly tighter option-card rows and the pinned versus in-flow actions.
