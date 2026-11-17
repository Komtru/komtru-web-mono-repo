# F-044 — Account basics, addresses, documents and system states (T-204)

Shot with `pnpm visual-check` against the **v2 master**, on `next dev` and a canned stand-in for the platform routes (one proxy adds the
sealed session cookie, and answers the platform's routes from fixtures). SP-M17 and SP-M18 need a tap before they exist, so they were shot
with the harness's own modules and one step added (sign in against a canned 429; open the camera sheet on a throwaway page); neither
helper is committed.

| Screen | Route                           | State                               | Differing pixels                                    |
| ------ | ------------------------------- | ----------------------------------- | --------------------------------------------------- |
| SP-M01 | `/account/addresses`            | two addresses, one default          | 13.89%                                              |
| SP-M02 | `/account/addresses/<id>`       | editing a filled address            | 8.67%                                               |
| SP-M33 | `/account/display`              | defaults                            | 3.40%                                               |
| SP-M11 | `/trade/<id>/documents`         | a settled Trade, as the buyer       | 8.96%                                               |
| SP-M12 | `/account/refunds`              | one refund on its way back          | 4.27%                                               |
| SP-M13 | `/account/statements`           | first state, before an export       | 9.56%                                               |
| SP-M14 | `/status`                       | the platform answering 503          | 5.42%                                               |
| SP-M15 | `/update-required`              | the screen                          | 2.80%                                               |
| SP-M16 | `/session-expired?next=/trades` | the screen                          | 3.03%                                               |
| SP-M17 | `/login`                        | after a 429 with `Retry-After: 872` | 2.17%                                               |
| SP-M18 | the proof camera sheet          | before the browser's prompt         | 31.66% (a sheet over a page, against a full screen) |
| SP-M19 | `/trades/<code>`                | a code that opens nothing           | 13.59%                                              |

The shot is of the first state of each. Loading, empty, error, offline and every non-initial state (a failed change, a held refund, a
paused sign-in counting down, an exported file) are held by the tests named in each file, each with an axe pass.

## Deviation from "ui-kit only", recorded

Three places use markup that is not a ui-kit component, each with precedent in the app (`EntryFrame`, `Loading`) and each for a stated reason:

- `src/system/SystemHero.tsx` is an app-local component with a raw `<svg>`. ui-kit's `StatusHero` draws status marks (tick, clock, bang); the reference draws a neutral ring with a camera, a download arrow, a triangle and an alert, and a clock over "Allow the camera" says the wrong thing. Used by SP-M15, SP-M17, SP-M18 and SP-M19.
- `Statements` uses a native `<input type="checkbox">` for "Includes": ui-kit has a `Toggle` (an immediate setting) but no checkbox, and this is a choice among several, not a switch.
- `Refunds` draws each refund as a hand-styled `<article>`: ui-kit has no card with a heading, a timeline and links in it, and the timeline inside is ui-kit's `VersionTimeline`.

Moving any of these into ui-kit is a follow-up for that package, not this ticket.

## Fix pass (after review)

SP-M15 is recorded as not live (its file says so). Display preferences now apply before first paint. The refund poll backs off and gives up. Re-shot: none; none of the fixes changes how a screen looks (the inline script sets the same attributes the effect did), apart from the one-frame "Getting the camera ready…" in the camera sheet.
