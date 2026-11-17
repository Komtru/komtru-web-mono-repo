# SP-M16 — Session expired (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7525 — Supporting · System states
- **Built:** http://localhost:3146/session-expired?next=%2Ftrades
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 6,799 of 224,400 (3.03%)
- **Side by side:** `SP-M16.png` (reference · built · heat map) — **heat map:** `SP-M16.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen is the entry frame (`EntryFrame`, ui-kit's `MobileShell`) with no app shell, shot with `--content [class*=max-w]` so the shot starts at the frame. The reference's top bar is drawn by the frame; its sticky footer is the frame's `StickyFooter`. The shot ran against `next dev` and a canned stand-in for the platform routes, so times and references are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **No phone number is remembered, and there is no "Send me a code".** The reference keeps the number so a code can be sent in one step. Sign-in here is a password (and a second step for some accounts); there is no sign-in by code to send, and a number kept on the device could be the last person's on a shared phone. So the screen explains the sign-out in the reference's words, then **Log in** goes to the ordinary log in and carries `next` so one step brings the person back to the screen they were on. **Use a different account** goes to log in without it (the reference's "Use a different number").
- **How it is reached:** `onSessionEnded` (a refresh that comes back with no session) goes to `/session-expired?next=<where they were>` instead of straight to `/login`. A place that cannot be returned to (an entry screen) is dropped. Explicit sign-out does not come here. The route is open to anyone.
- **Not reached:** the sign-in gate (middleware) still sends a request with no valid session cookie straight to `/login?next=…`. It cannot tell "never signed in" from "signed in and expired", so a page load after the cookie lapses lands on log in, not here; only a session that ends while the app is open lands here.
- Held by `test/system-states.test.tsx`, `test/system-reach.test.tsx`, `test/providers.test.tsx` and `test/sign-out.test.tsx`.
