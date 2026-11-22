# Tell people which verification step they still owe — design

_2026-11-22 · owner decision · builds on F-081 (contacts) and F-045 (ID)_

## Problem

Every step already exists. VF1 (`/account/verification`) confirms an unproven email or phone (F-081) and
runs the ID check, NIN or BVN plus a selfie (F-045). Nothing tells a person which of those they still owe:
the Verification row in Account carries no status, and the dashboards say nothing. People find out when the
platform refuses an action:

- `POST /trades/:id/send` and funding refuse a buyer without both email and phone confirmed
  (`CONTACT_VERIFIED`);
- a trade cannot be funded until its seller's ID is verified (`IDENTITY_VERIFIED`, `trades/domain/eligibility.ts`).

Someone who signed up with a phone number has an unconfirmed email, and someone who signed up with an email
has an unconfirmed phone. Neither is told.

## Owner decisions (2026-11-22)

1. **A "Finish verifying" card at the top of both dashboards**, Buy's Home and Sell's Shop (F-083). It names
   each missing step, links straight to it on VF1, and goes away once nothing is left on that side.
2. **ID is required on Sell, optional on Buy.** Shop lists "Verify your ID" as needed to get paid. Home lists
   it as recommended, because it raises your trust.
3. **The card can't be dismissed while a required step is open.** Email and phone are required on both sides,
   and ID is required on Sell. An optional step (ID on Buy) has "Not now", which hides that step on this device.

## The steps, in order

| Step               | Done when                              | Buy · Home  | Sell · Shop |
| ------------------ | -------------------------------------- | ----------- | ----------- |
| Confirm your email | `GET /me` `contacts.email` is verified | required    | required    |
| Confirm your phone | `GET /me` `contacts.phone` is verified | required    | required    |
| Verify your ID     | level is `IDENTITY_VERIFIED` or above  | recommended | required    |

- An ID check that is in review (an in-flight NIN, BVN or selfie in the verification status) shows
  "In review", with no action. A rejected one shows "Try again" and links to VF1.
- The wording names the channel the person did not sign up with. "You signed up with your phone. Confirm
  your email so we can send your receipts." The reason line says what each step unlocks: contacts let you
  send and pay for trades, and ID lets buyers pay into a trade you're selling.
- Each step links to VF1 at that step's section.

## Boundaries

- This is information, not a gate. The server keeps deciding every refusal. The card reads the same facts VF1
  already reads (`useMe`, `useVerificationStatus`) and ranks no levels of its own beyond "is ID verified".
- No new backend. No new reference screen: it is drawn with the existing `NoteBanner`, `SettingsRow` and
  `Chip` patterns, the way VF1's contact rows are.
- "Not now" for the optional ID step is a per-device preference (localStorage), like the display settings.

## Not in this feature (offered, not chosen)

- A status on the Account → Verification row ("2 steps left").
- A prompt at the blocked action (Start Trade, Send, Fund) before the platform refuses.
- An extra onboarding step straight after sign-up.
