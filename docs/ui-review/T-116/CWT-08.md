# CWT-08 — Trade Activity (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10809 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000008/activity
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,234 of 224,400 (11.25%)
- **Side by side:** `CWT-08.png` (reference · built · heat map) — **heat map:** `CWT-08.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **Rows carry no amounts, waybill or "Komtru payment service" source line.** The feed deliberately sends labels, who and when and nothing else: the rows it is built from also hold deadlines, risk wording and staff-written reasons, which a party must not read. A decline or cancellation reason a party wrote is shown, since the decline sheet promises "they'll see your reason".
- **"Trade created" is not a row of its own**: there is no state change for it (the trade is created when the terms are accepted, and "Terms agreed" is that row).

**Real differences**

- **Newest first, paged with "Show earlier activity"**; the drawing shows four rows. Rows past the first page are fetched with the platform's cursor.
- "Read only" is a banner where the drawing has a chip and a line; the closing note says that Komtru's own steps appear simply as Komtru (a party cannot tell staff from automation, deliberately).
- The tab strip sits under the header, and there is no "Back to trade overview" pinned button; the header's back arrow and a button in the flow do that.
