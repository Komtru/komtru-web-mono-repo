# Onboarding walkthrough on tablet and desktop (F-067, F-072)

**Scope:** OB1 Protection, OB2 Transparency, OB3 Trust Profile, OB4 Enable Notifications, OB5 You're All Set, at tablet
(md, 768px+) and desktop (lg, 1024px+). `apps/web-app-ui/src/welcome/**` and its routes only. Frontend only; no backend.

## What the reference draws

The reference draws OB1–OB5 for mobile only. The nearest wide drawings are DX-01 (brand story beside the form) and
TX-01 (a centred card on a calm background). The walkthrough is shown after sign-in, so DX-01's brand and Trade Code
panel does not apply. Owner-approved direction: TX-01's card at both widths, roomier on desktop.

## Decisions

- **One tree, CSS only for the frame.** `WelcomeFrame` gains `md:` and `lg:` classes: a `surface-secondary` page, the
  Komtru mark above a centred card, the actions at the foot of the card (`md:static`, no gradient) instead of pinned to
  the window. Below 768px every class is the one it was, so the phone is unchanged.
- **Tablet card ~560px, desktop card 600px (OB4, OB5) and 880px (OB1–OB3)**, with the larger heading, body and art.
- **Desktop overview (OB1–OB3 only).** At `lg`, a list of the three walkthrough points sits beside the current step
  with the current one marked. It repeats copy, so it is the one thing a width adds: it is drawn from `useViewport`
  (a phone and jsdom are "mobile", so phone tests never see it) and sits at a fixed child position in an always-present
  wrapper, so the step content never remounts when the window crosses 1024px.
- **Unchanged:** Skip/Next, the dots, notification permission and its refusal states on OB4, the gate in
  `useWelcomeGate.ts`, `state.ts`, every route.

## Order (each a green commit)

1. Tests (`test/welcome-wide.test.tsx`): wide frame at tablet and desktop for each screen, the overview only at desktop,
   the phone has none, resize keeps the step and an in-progress OB4 refusal (node identity), axe at each width.
2. `WelcomeFrame` and the five screens' responsive classes; the overview.
3. Visual capture at 1280 and 820, a real `next start` load of every route at both widths, `docs/ui-review/onboarding-wide.md`.

## Not touched

`src/entry/**`, `src/system/**`, `src/shell/**`, `packages/**`, `src/account/**`, `src/trade/**`.
Shared tooling appended to only: one walk for OB5 (it is reached through OB4) in `tools/visual-check/src/walkthroughs.ts`.
