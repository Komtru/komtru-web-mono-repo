# AS1 — Account Suspended (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7232 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/account/suspended
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 12,542 of 224,400 (5.59%)
- **Side by side:** `AS1.png` (reference · built · heat map) — **heat map:** `AS1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- Heading, lead and icon are the reference's. **Deviations, each because the platform does not back the reference's sentence:**
  - "What's still protected" (escrow stays protected, you can still confirm delivery or respond to a dispute) becomes **What still works**, built from the platform's own `abilities` ("You can still sign in and look around and withdraw money already released to your balance."). A locked account, which cannot sign in, gets no such banner. The escrow and dispute promises are not in anything the platform sends.
  - "Typical timeline: Within 48 hours" is dropped: no SLA backs it.
  - "You'll be notified the moment a decision is made, with the reason" becomes **Where it stands: This page always shows your account's current state**: the platform deliberately never sends the staff reason.
- A **restricted** or **locked** account gets its own title and lead; an account in good standing sees "Nothing is holding your account" with a way home.
- **Contact TrustOps about this** has no inbox to open yet: it shows the account's support reference to quote.
- Reachable from Account: a restricted, suspended or locked account sees a banner there linking to this screen. No automatic redirect: that needs middleware that knows the account's state, which this ticket does not add.
