# AS1 — Account Suspended (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7232 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/account/suspended
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 13,269 of 224,400 (5.91%)
- **Side by side:** `AS1.png` (reference · built · heat map) — **heat map:** `AS1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- Words, banner and the three "What happens next" rows are the reference's. The icon is `StatusHero`'s ring with the risk mark rather than the reference's bare circle.
- The reference has no secondary state. Here a **restricted** or **locked** account gets its own title and lead (the reference only draws suspended), and an account in good standing sees "Nothing is holding your account" with a way home.
- **Contact TrustOps about this** has no inbox to open yet: it shows the account's support reference to quote. The staff-written reason is never sent by the platform, so none is shown.
