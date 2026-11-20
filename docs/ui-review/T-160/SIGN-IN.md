# Logistics portal sign-in (T-160)

- **Reference:** none. The v2 master has no `logistics-ops` screens (FEATURE_MAP F-065, Epic 15), so the
  check is design-system conformance: tokens, shells and primitives used as `ui-kit` defines them.
- **Built:** `apps/logistics-ops`, production build served on port 3965 against the visual stand-in on 7965.
- **Shots (not committed, `pnpm visual-capture`):** `sign-in-desktop.png` (1040), `sign-in-mobile.png` (375),
  `sign-in-no-access.png` (1040, the `403 NO_LOGISTICS_ACCESS` state, reached with the login handler's
  answer intercepted in the browser).

## Conformance

- The page is the operations-app `AuthPage` footprint: centred 420px column on `bg-surface-secondary`,
  `KomtruLogo` above a card in `border-border-hairline` / `bg-surface-primary` / `rounded-md`. The
  ops lockup (`product="ops"`) is not used; `KomtruLogo` has no logistics lockup, so the consumer mark
  is drawn with a "Logistics portal" label in the `SectionLabel` type treatment.
- Fields are `TextField`, the action is the primary `Button`, messages are `Banner`. No colour, radius,
  shadow or duration is declared in the app; every class is a `@komtru/config` token.
- "This account isn't attached to a logistics company" is a `warning` Banner with its own title and
  guidance, never the `risk` Banner a wrong password draws (T-160 AC).
- The two-step form (second factor) is the operations-app sign-in's, unchanged in look; it appears only
  for an account that has a factor (logistics sessions follow the consumer MFA rule, `mfaRequirement`).

## Deviations

- No logistics lockup in `KomtruLogo` (`product?: 'ops'` only). Drawn as the consumer mark plus a label;
  a `logistics` lockup belongs in `ui-kit` if the brand wants one.
