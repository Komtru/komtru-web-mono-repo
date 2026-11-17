# SP-M18 — Camera permission (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7562 — Supporting · System states
- **Built:** http://localhost:3146/vc-camera
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 71,046 of 224,400 (31.66%)
- **Side by side:** `SP-M18.png` (reference · built · heat map) — **heat map:** `SP-M18.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen is the entry frame (`EntryFrame`, ui-kit's `MobileShell`) with no app shell, shot with `--content [class*=max-w]` so the shot starts at the frame. The reference's top bar is drawn by the frame; its sticky footer is the frame's `StickyFooter`. The shot ran against `next dev` and a canned stand-in for the platform routes, so times and references are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **Reached in the proof camera.** Opening it (`CameraSheet`) says this first, before the browser's own prompt, unless the browser already says the camera is allowed or blocked; once **Allow the camera** is chosen, this device is not asked again. **Not now** leaves the camera untouched and offers the gallery ("No problem. Choose photos you took earlier"), and remembers nothing, so it is explained again next time.
- It is a **sheet over the proof screen**, not the reference's full screen titled "Proof of the Item", because it is the first thing the camera sheet shows. The shot used a throwaway page rendering the real sheet (the interactive shooter, not committed), so the heat map includes the dimmed page and the sheet's own title and handle.
- **"Used only to take photos and scan codes" is "Used only to take photos for a Trade".** The proof flow takes photos and nothing scans a code.
- **"You can change this any time in Privacy & data" is "You can see where this stands in Privacy & data" with a link.** A page cannot switch a camera permission, and SP-M03 states the browser's answer and says where to change it, so no switch is promised.
- On browsers that cannot say either way (Safari has no camera permission query) the explanation is shown once per device; that is most of the point there.
- The camera suites (`test/proof-capture.test.tsx`) now start with the device already past this step, and `test/camera-permission-flow.test.tsx` holds this one: explain first and not touch the camera, Allow, Not now, already allowed or blocked, once per device, with axe.
