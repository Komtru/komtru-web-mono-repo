# CA2 — Confirm Closure (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` (see `SCREEN_INDEX.md`)
- **Not shot:** in-flow state the harness cannot set.

## Deviations

Not shot: CA2 is the sheet over CA1 and needs in-flow state. Held by `test/close-account.test.tsx`: the sheet says "This can't be undone", holds the red button until the password is given and the box is ticked, closes through `POST /me/close`, signs the device out, and asks for a code instead when the account has no password. The sheet also has a **password** field, which the reference does not draw. It is optional on the button: an account that signs in by phone code has no password, and the platform answers with a step-up request, so the button waits only for the tick and the platform decides what proof is needed (an account with a password is told to enter it). Same for Delete my data.
