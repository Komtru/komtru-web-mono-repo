# T-111 — Entry and authentication

Shot with `pnpm visual-check` against the v1 reference file, which the harness reads; the entry
screens are unchanged between v1 and v2.

| Screen | Route                 | Shot | Differing pixels |
| ------ | --------------------- | ---- | ---------------- |
| E1     | `/`                   | yes  | 0.09%            |
| E2     | `/signup`             | yes  | 0.39%            |
| E4     | `/login`              | yes  | 0.84%            |
| AC2    | `/reset-password`     | yes  | 0.21%            |
| TOS1   | `/signup/terms`       | no   | —                |
| E3/E3b | `/verify`             | no   | —                |
| AC3    | `/reset-password/new` | no   | —                |
| TOS2   | `/terms-updated`      | no   | —                |

## Why five screens are not shot

The harness opens a URL in a fresh browser. TOS1, E3, E3b and AC3 read what the earlier screen
remembered in session storage (the typed number, the challenge a code was sent for) and send a cold
visit back to the start, which is correct behaviour and leaves nothing to shoot. TOS2 needs a signed-in
account whose accepted Terms are older than the ones in force. All five were checked by hand in the
running app against the real backend on 2026-11-09 (sign-up through E3b to a session, log-in, and a
full password reset), and their behaviour is held by `apps/web-app-ui/test/entry-screens.test.tsx`.

## Deviations on the unshot screens

- **TOS1:** both acknowledgements start unticked (the reference draws them ticked): consent the
  person did not give is not consent (NDPA §15). A link to the full Terms sits at the end of the
  summary box.
- **E3/E3b:** an unfilled cell is empty, where the reference draws `·`. The trust note uses the
  emerald info mark, as drawn. A spent code shows "Send a new code" as the only action.
- **AC3:** there is a visually hidden heading and a line saying where the code went, which the
  reference does not draw. The placeholder says "At least 10 characters", not 8: the platform's
  password policy refuses anything shorter (`credential/policy.ts`).
- **TOS2:** the "What changed" rows appear only when `src/entry/terms-copy.ts` records the changes
  for the version in force. No version has a recorded changelog yet, so the screen says the Terms
  changed and links to them in full instead of showing invented rows.
- **First password (`/set-password`):** the phone path sets a password after the number is proved
  (M1 §9.3). The reference draws no screen for this; it is AC3's two fields without the code.
