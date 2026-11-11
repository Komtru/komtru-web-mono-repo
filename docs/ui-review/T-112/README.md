# F-013 — First-time onboarding walkthrough (T-112)

Shot with `pnpm visual-check --content main` against the **v2 master**, against the real production build with a
sealed session cookie added by a one-line proxy. OB4's default state needs the browser's notification permission to be
`default`; headless Chromium reports `denied`, so that shot ran with the permission forced by an injected script, and the
denied state is kept as its own shot.

| Screen     | Route                    | State                           | Differing pixels |
| ---------- | ------------------------ | ------------------------------- | ---------------- |
| OB1        | `/welcome/1`             | Protection                      | 0.50%            |
| OB2        | `/welcome/2`             | Transparency                    | 0.51%            |
| OB3        | `/welcome/3`             | Trust Profile                   | 0.30%            |
| OB4        | `/welcome/notifications` | permission `default`            | 2.03%            |
| OB4-denied | `/welcome/notifications` | permission `denied` (not in v2) | 13.14%           |
| OB5        | `/welcome/done`          | no name kept                    | 1.14%            |

## Judgement

**Pass.** Layout, copy, components and tokens match the reference; what is left is text anti-aliasing, the sample name
on OB5 and OB4's blocked state, which the reference does not draw. See each screen's deviations.
