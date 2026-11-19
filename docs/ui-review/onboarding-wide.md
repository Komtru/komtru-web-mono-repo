# Onboarding walkthrough, tablet and desktop (F-067, F-072)

OB1 Protection, OB2 Transparency, OB3 Trust Profile, OB4 Enable Notifications, OB5 You're All Set at 820px (tablet,
above the app's 768px `md`) and 1280px (desktop). Built with `next start` against the platform stand-in; captured with
`pnpm visual-capture` (`--path /welcome/<step>`, and `--walk OB5` for the last screen).

## What was compared, and how

The reference draws OB1–OB5 on mobile only, so there is no frame to score a wide screenshot against: the harness's
pixel diff does not apply. Each capture was read by eye against the mobile drawings (copy, order, art, actions) and
against TX-01's card ("Centered card on a calm background"): the Komtru mark above one white card on the secondary
surface. DX-01's brand and Trade Code panel is not used: the walkthrough is shown after sign-in. The harness's own
tablet frame is 560px, below `md`, so it was not used for tablet.

Every welcome route was loaded in a real Chromium against `next start` at 1280, 820 and 390: HTTP 200, no console or
page error, no horizontal scroll, one `h2` per screen. A window dragged across 390, 820 and 1280 on OB2 kept the same
heading node; an OB4 refusal kept its note and its Continue button across a resize.

## What each width draws

| Screen         | 390 (phone) | 820 (tablet)                                                        | 1280 (desktop)                                                                             |
| -------------- | ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OB1, OB2, OB3  | unchanged   | 560px card, art, heading 24px, dots, Skip left and Next right below | 880px card; the three points beside the step with the current one marked; same step column |
| OB4 Enable     | unchanged   | 560px card, 72px bell, actions centred at the foot                  | 600px card, same content                                                                   |
| OB5 You're set | unchanged   | 560px card, the two actions stacked and centred at the foot         | 600px card, same content                                                                   |

On a phone the actions stay the pinned `.btn-sticky` footer; from 768px the footer is `static` at the card's foot
(measured in the browser: `sticky` at 390, `static` at 820 and 1280).

## Deviations from the reference, for the owner

- **No wide drawing exists for OB1–OB5.** The card follows TX-01 and the owner-approved direction; the desktop overview
  of the three points (the steps' headings repeated as a list) is the one addition and is desktop only.
- **The card is 880px on OB1–OB3 and 600px on OB4 and OB5** on desktop, because only the first three carry the overview.
  The card therefore changes width when Get started leads to OB4. One width everywhere is a one-class change if preferred.
- The overview is not clickable: the step-by-step flow and its Skip/Next are the only way through.
- A browser that reports notifications as blocked (headless Chromium does) shows OB4 with Continue in place of
  Allow/Not now, as the phone does; that is the captured OB4 state at both widths.
- Seen while testing, not changed (the phone has it too): OB4's note sits in a `role="status"` region and the
  `NoteBanner` inside it is another `role="status"`.
