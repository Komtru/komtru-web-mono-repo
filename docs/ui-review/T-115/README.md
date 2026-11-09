# F-017 — Propose a trade, invite the other party (T-115)

Shot with `pnpm visual-check` against the **v2 master** (`KOMTRU_VISUAL_CHECK_REFERENCE=v2`, see below),
against the real app and a canned stand-in for the backend, signed in through a sealed session cookie.

| Screen     | Route                    | Differing pixels |
| ---------- | ------------------------ | ---------------- |
| I3         | `/trade/new`             | 9.26%            |
| CTS1       | `/trade/standards`       | 5.99%            |
| IF1        | `/trade/[id]` (rejected) | 20.96%           |
| G3         | `/trade/[id]` (held)     | 26.25%           |
| Q1         | `/trades`                | 4.79%            |
| R1         | `/trade/[id]` (seller)   | 10.47%           |
| Customer-2 | `/trade/[id]` (buyer)    | 10.13%           |
| TC-05      | `/trade/[id]/counter`    | 14.76%           |
| TC-06      | `/trade/[id]` (agreed)   | 9.46%            |

Every figure includes the app shell's brand row and tab bar, which the reference does not draw on these
screens (see each file). The two highest, G3 and IF1, are the two where the built screen shows less than the
drawing because what it would show is post-MVP.

## The harness reads the v1 reference unless told otherwise

`tools/visual-check` read `SCREEN_INDEX-v1.md` and `Komtru — UI Screens Living Master File.html` only. The
usage string saying `SCREEN_INDEX-v1.md` was not stale, it was accurate: v2 line numbers (G3 at 3840, TC-05
at 10315) read against the v1 HTML point at unrelated screens, and G3, TC-05 and TC-06 do not exist in v1.
`KOMTRU_VISUAL_CHECK_REFERENCE=v2` now switches both the index and the HTML. The v2 master also declares
`.mweb-frame` as `min(340px,100%)`, which the frame reader rejected; it now reads that as 340px and skips a
bare `100%`.

Not shot: the invite states (waiting, sent, invitation, claim) and the closed states have no v2 drawing.
MI1, MI2 and AC4 are gated off for MVP (F-020).
