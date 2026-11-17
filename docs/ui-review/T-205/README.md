# F-045 — Verify yourself, and close or recover an account (T-205)

Shot with `pnpm visual-check --content main` against the **v2 master**, on `next dev` and a canned stand-in for the platform
routes (one proxy adds the sealed session cookie).

| Screen | Route                          | State                                  | Differing pixels |
| ------ | ------------------------------ | -------------------------------------- | ---------------- |
| SP-M03 | `/account/privacy`             | camera unknown, as the harness browser | 4.83%            |
| SP-M04 | `/account/security`            | two-step off, two devices              | 3.81%            |
| SP-M05 | `/account/phone`               | empty form                             | 15.88%           |
| TF1    | `/account/security/two-factor` | key issued, no code typed              | 14.21%           |
| CA1    | `/account/close`               | a trade in progress                    | 3.77%            |
| AS1    | `/account/suspended`           | suspended                              | 5.59%            |
| AS2    | `/shop/suspended`              | suspended, selling paused              | 5.25%            |
| VF1    | `/account/verification`        | selfie check failed                    | 12.56%           |

TF2 and CA2 are in-flow states (codes shown once; a sheet over CA1) the harness cannot set; their `.md` says which tests hold them.
