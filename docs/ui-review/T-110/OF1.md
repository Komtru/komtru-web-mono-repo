# OF1 — My Trades — Offline (T-110)

- **Reference:** `docs/design-reference/Komtru — UI Screens Living Master File.html` line 2404 — Empty State & Password Reset — Mobile Web
- **Built:** http://localhost:3001/trades
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 5,842 of 224,400 (2.60%)
- **Side by side:** `OF1.png` (reference · built · heat map) — **heat map:** `OF1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

Shot against `/trades` with the app online. The chrome — brand row, body padding, tab bar — is this
ticket's; everything else on the reference's screen belongs to a state or a ticket named below.

**Intended, decided before the screen was built**

- **Five tabs, not four.** The reference draws Trades · Passport · Alerts · Settings. Design C22 and
  §6.3 fix the tab bar at Trades · Explore · Alerts · Messages · Account, with Shop replacing
  Explore for a certified merchant, so every tab after the first differs from the drawing. Passport
  is no longer a tab: the Trust Passport is a public page at `passport.komtru.com`, reached from a
  seller rather than from a tab of your own.
- **The Messages glyph is new.** The reference has no Messages tab, so there is no icon to lift. It
  is drawn in the reference's own idiom — one 24 viewBox, weight 2, round caps, one path.
- **No bell in the brand row.** The reference's `.scr-logo-row` carries a struck-through signal icon
  on this screen only, as the offline indicator. Alerts is a tab here, and the offline state says so
  in words rather than in a glyph beside the wordmark.

**States this shot cannot show**

- **The offline banner and the "You're offline" copy.** They are drawn by the shell whenever the
  browser loses its connection (`src/shell/OfflineStatus.tsx`), and the visual-check harness has no
  way to take Chromium offline, so the shot is of the same screen online. The banner's geometry is
  held against `.offline-banner` by `packages/ui-kit/test/primitives-parity.test.tsx`, and its
  behaviour by `test/offline-status.test.tsx`.
- **The queued-action note.** `<QueuedActionNote>` exists in `ui-kit` and matches `.offline-queued`
  in parity, but nothing in this ticket can queue a mutation — the first one is T-116's "Confirm
  delivery" — so the shell does not draw it yet. Rendering it with no queue behind it would be a
  screen telling someone their tap was saved when nothing was.

**Content other tickets own**

- **The two trade rows.** T-116 builds the trades list; the empty-state card in its place is this
  ticket's scaffold and is deleted when that list lands. The second row's "Last synced 6 minutes
  ago" line and its dimmed treatment belong with it.
