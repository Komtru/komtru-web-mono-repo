# CA1 — Close Your Account (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7312 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/account/close
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 8,454 of 224,400 (3.77%)
- **Side by side:** `CA1.png` (reference · built · heat map) — **heat map:** `CA1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's blocked state draws a **trade row** ("₦452,000 · TechEdge NG") and "1 Trade". The platform sends only whether a trade is in progress (`openTrades`, a boolean), so the banner says "a Trade" and the button sends the person to their Trades. Intended.
- When nothing is in progress (not shot: the reference draws only the blocked variant) the screen offers an optional **Why are you leaving?** select (the platform records one of four codes; free text is deliberately not collected) and the **Close my account** button. A `null` answer from the platform does not block: the platform decides on submit, and its refusal turns the screen to the blocked state.
