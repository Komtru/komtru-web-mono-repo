# F-029 — Capture and compare proof media (T-197)

Shot with `pnpm visual-check --content main` against the **v2 master**, on `next dev` behind a one-line proxy that adds a
sealed session cookie, with a canned stand-in for the platform routes. PM-1 to PM-5 are steps inside other flows (the
seller's proof step, the buyer's review) rather than routes of their own, so those five were shot on a throwaway harness
page that mounted the real component in the stated state (not committed); PM-6, PM-7 and PM-8 are the real routes
(`/trade/<id>/evidence`, `/trade/<id>/inspect`, `/trade/<id>/record`). PM-2's live view uses a canvas stream because
headless Chromium has no camera. The harness and stand-in lived outside the repo and are gone; nothing of them is committed.

| Screen | Where it lives                                | State shot                         | Differing pixels |
| ------ | --------------------------------------------- | ---------------------------------- | ---------------- |
| PM-1   | the proof step (`ProofUpload`/`ProofCapture`) | 2 of 3 photos, video outstanding   | 9.55%            |
| PM-2   | the guided camera (`CameraSheet`)             | shot 3 of 4, live stream           | 11.44%           |
| PM-3   | the proof step                                | a flagged file                     | 13.86%           |
| PM-4   | the proof step                                | 4 photos and 1 video               | 11.67%           |
| PM-5   | `ProofReview` on CT-S7                        | a count, no listing                | 29.51%           |
| PM-6   | `/trade/<id>/evidence`                        | inspection, with dispatch evidence | 21.88%           |
| PM-7   | `/trade/<id>/inspect`                         | buyer, Seller's proof pane         | 24.43%           |
| PM-8   | `/trade/<id>/record`                          | settled                            | 15.09%           |

## Judgement

**Pass, with the deviations accepted.** Order, copy and components (info banner, requirement chips, photo grid, timeline,
term rows, evidence groups) follow the reference. PM-5, PM-6 and PM-7 score higher because the photo tiles are solid
stand-in images against the reference's pale placeholder tiles and the screens sit lower under their shell headers. What the
platform cannot state is not drawn as fact: originality and "taken on a camera", a human review, hub scans, the buyer's
inspection photos, a retention period, and rules the app does not enforce (that proof is locked or cannot change). One
blocking gap, corrected after review: the buyer already holds access grants on the seller's proof files before accepting,
but no read lists the file ids (the trade view carries only a count, and the inspection read is empty until shipment), so
CT-S7 can say how many files there are and not show them. Exposing the ids is an owner decision, so no backend change was made.
