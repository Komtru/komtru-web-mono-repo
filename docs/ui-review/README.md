# UI review

Every screen ticket ends with a visual check: the built screen screenshotted beside the HTML
reference frame it was built from, with a pixel-diff heat map and a written list of the deviations.
This directory holds the output.

```bash
pnpm browsers:install                                            # once per machine
pnpm --filter @komtru/web-app-ui dev                             # the app under review
pnpm visual-check --screen U4 --url http://localhost:3004/handover/KMT-88213
```

That writes three files to `docs/ui-review/<ticket>/`:

| File                | What it is                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| `<screen>.png`      | one strip: reference, built screen, heat map, separated by an indigo rule |
| `<screen>.diff.png` | the heat map on its own — flagged pixels in red over a faded reference    |
| `<screen>.md`       | the metadata and the deviation list you write                             |

**The PNGs are not committed; the `.md` files are.** The images are regenerated on every run of a
page that changes every commit, and three of them per screen across 210 screens is a permanent cost
for a transient read. The deviation list is the durable half of the review and diffs as text, so it
is tracked. `.gitignore` carries `docs/ui-review/**/*.png`.

Re-running a check refreshes everything above `## Deviations` and keeps everything below it, so a
list written by hand survives.

## What a flagged pixel means

A flagged pixel is a real deviation. Two things are done to keep that true.

**Fonts.** `@komtru/ui-kit` loads Space Grotesk, Inter and IBM Plex Mono through `next/font`, which
only exists inside a Next build; `tokens.css` names the three families and ships no `@font-face`.
Left alone the reference would render in the system fallback and the built app in the real faces,
and every diff would be a wall of typography noise with the actual deviations buried in it. So the
harness carries the three families as exact-pinned Fontsource dependencies — the same Google files
`next/font` self-hosts in the apps — and inlines them as `@font-face` into _both_ pages before
anything is captured. Both sides have all three faces available and only the markup decides which
one applies, so a screen that reaches for the wrong family still shows as a deviation. Masking text
was rejected (in a design-system build most deviations _are_ text) and so was linking Google Fonts
at screenshot time (a network round-trip makes the diff irreproducible offline).

**Motion.** Animations and transitions are disabled and the caret is made transparent on both pages.
A transition caught mid-frame is a difference between two runs, not between two designs.

## How the reference screen is found and drawn

`docs/design-reference/SCREEN_INDEX.md` maps each of the 210 screen ids to the line in the reference
HTML where that screen starts. The harness carves that one screen out into a standalone document
carrying every `<style>` element from the reference and the screen's ancestor chain — `#p3-canonical`
scopes eighteen rules that set the Part 3 geometry, and a screen lifted out of its section loses
them. The gallery caption (`.screen-num`) is left behind; it is furniture, not part of the screen.

The carved page is rendered at the gallery's own 1280px and the frame is pinned to its declared
width, rather than rendering at the frame's width directly: the reference carries
`@media(max-width:900px)` rules from the design system it was assembled from, and at a 560px viewport
those fire and redraw a tablet screen as something the reference never shows. The built page gets a
viewport of exactly the compared size — its own media queries are the thing under test.

The shot is clipped to the frame's content, leaving out the mock browser bezel: a drawing of a URL
bar is not something a built screen can match, and leaving it in would put a guaranteed band of
deviation at the top of every mobile shot. The frame's border, radius, shadow and bezel padding go
with it, which is also what makes the shot exactly the declared width rather than two pixels short.

## The widths

Every width is re-read from the reference's own CSS, never typed into the harness, and
`tools/visual-check/test/frames.test.ts` fails if the reference stops declaring one. The reference
states the geometry itself, in a comment on `#p3-proportion-fix-v8`: "desktop 1040px max, tablet
560px fixed".

| Reference frame         | Device  | Width | Screens |
| ----------------------- | ------- | ----- | ------- |
| `.mweb-frame`           | mobile  | 340   | 150     |
| `.device.phone`         | mobile  | 230   | 1 (P1)  |
| `.dweb-frame.tablet`    | tablet  | 560   | 5       |
| `.p2-browser.p2-tablet` | tablet  | 560   | 4       |
| `.dweb-frame.desktop`   | desktop | 1040  | 39      |
| `.p2-browser`           | desktop | 1040  | 11      |

## The checklist a screen ticket follows

1. Build the screen, then start the app it lives in.
2. Run `pnpm visual-check --screen <id> --url <url>` for each screen the ticket owns —
   `SCREEN_INDEX.md` says which ticket owns which.
3. Open `<screen>.png`. The heat map is what to read: red is a deviation.
4. Write every deviation under `## Deviations` in `<screen>.md`, one per line, saying whether it is
   intended and why. "The reference draws a capless brand mark here; `<KomtruMark>` is round-capped
   by design (T-011)" is a complete entry. An empty list means the screen matched.
5. Commit the `.md`. Do not commit the PNGs.

## Notes

- `logistics-ops` has no screens in the reference at all (Epic 15 says so), so its visual check is
  design-system conformance rather than screenshot-versus-reference.
- `TO-PA10` appears twice in `SCREEN_INDEX.md` — the reference draws that screen as two variants.
  Pass `--line` to choose one; the harness refuses to guess.
- The screenshots are deterministic on one machine, not across machines: Chromium's text rasterising
  differs between platforms. Compare a run against the reference, not against someone else's PNG.
