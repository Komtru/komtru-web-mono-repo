# SP-M15 — Update required (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7507 — Supporting · System states
- **Built:** http://localhost:3146/update-required
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 6,289 of 224,400 (2.80%)
- **Side by side:** `SP-M15.png` (reference · built · heat map) — **heat map:** `SP-M15.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen is the entry frame (`EntryFrame`, ui-kit's `MobileShell`) with no app shell, shot with `--content [class*=max-w]` so the shot starts at the frame. The reference's top bar is drawn by the frame; its sticky footer is the frame's `StickyFooter`. The shot ran against `next dev` and a canned stand-in for the platform routes, so times and references are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's **Update now** opens a store listing. On the web an update is a reload, so it empties the saved pages (the old version's own files may be among them) and reloads, and reloads even if the saved pages cannot be cleared, so nobody is stuck on this screen.
- **Why am I seeing this?** is a disclosure.
- The icon is a neutral ring with a download arrow, as the reference draws it (`SystemHero`, since ui-kit's `StatusHero` draws status marks).
- **How it is reached, and the honest limit:** any 426 Upgrade Required from the platform sends the person to `/update-required` (`SystemWatcher`). **The platform sends no 426 today**: it has no minimum supported version. So this screen is wired and waiting, not live; making it live is a backend decision (a version header and a floor), which is not part of this ticket.
- Held by `test/system-states.test.tsx` and `test/system-reach.test.tsx`.
