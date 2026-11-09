# F-017 — Propose a trade, invite the other party (T-115)

Shot with `pnpm visual-check` against the **v2 master** (the harness default; see below),
against the real app and a canned stand-in for the backend, signed in through a sealed session cookie.

| Screen         | Route                    | Differing pixels |
| -------------- | ------------------------ | ---------------- |
| I3             | `/trade/new`             | 9.19%            |
| CTS1           | `/trade/standards`       | 5.93%            |
| IF1 (see note) | `/trade/[id]` (rejected) | 21.13%           |
| G3             | `/trade/[id]` (held)     | 25.52%           |
| Q1             | `/trades`                | 5.12%            |
| R1             | `/trade/[id]` (seller)   | 9.98%            |
| Customer-2     | `/trade/[id]` (buyer)    | 10.04%           |
| TC-05          | `/trade/[id]/counter`    | 15.18%           |
| TC-06          | `/trade/[id]` (agreed)   | 9.38%            |

Shot with `--content main`, which starts the built shot at the screen's own content instead of the page top,
so the app shell's brand row no longer shifts every line (the earlier figures compared text 54px apart). The
percentages are small because most of each frame is white either way; read the heat maps, whose red is now
real differences in what a screen says. G3 and IF1 are highest because the built screens show less than the
drawings: what they would show is post-MVP. **IF1 is not IF1**: it is the layout reused for a rejected
proposal, because IMEI is F-020; see `IF1.md`.

## The harness reads the v1 reference unless told otherwise

`tools/visual-check` read `SCREEN_INDEX-v1.md` and `Komtru — UI Screens Living Master File.html` only. The
usage string saying `SCREEN_INDEX-v1.md` was not stale, it was accurate: v2 line numbers (G3 at 3840, TC-05
at 10315) read against the v1 HTML point at unrelated screens, and G3, TC-05 and TC-06 do not exist in v1.
v2 is now the harness's default (`KOMTRU_VISUAL_CHECK_REFERENCE=v1` selects the old files), and `--content <selector>` starts the built shot at an element, so shell chrome the reference does not draw does not offset the comparison. The v2 master also declares
`.mweb-frame` as `min(340px,100%)`, which the frame reader rejected; it now reads that as 340px and skips a
bare `100%`.

Not shot: the invite states (waiting, sent, invitation, claim) and the closed states have no v2 drawing.
MI1, MI2 and AC4 are gated off for MVP (F-020).
