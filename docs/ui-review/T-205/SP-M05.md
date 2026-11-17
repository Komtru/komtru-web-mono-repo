# SP-M05 — Change phone number (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7907 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/phone
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 35,628 of 224,400 (15.88%)
- **Side by side:** `SP-M05.png` (reference · built · heat map) — **heat map:** `SP-M05.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **The flow is real.** The reference's fields and three steps are the platform's now: **Send a code** names the new number and a code goes to the current one; the current number's code sends a second to the new one; the new number's code makes the change, and the old number is told (SMS to it, plus email and in-app). The screen walks the three steps with the timeline marking where the person is.
- The reference prefills **Current number**. The platform holds it and sends the first code there, so the person is never asked to type it; the code step says where it went (`+23480•••4471`).
- **I've lost access to my number** replaces the reference's "I can't get the code". It opens the platform's lost-phone **recovery request** (the number typed), says plainly that it does not change the number and that a person checks the ID within 24 hours. It is not offered as a way to make this change: that flow carries no new number.
- Shot at the first step (new number empty), so the heat map is the first step only; the code steps are held by `test/change-phone.test.tsx`.
- **Step-up first.** "Send a code" opens the ui-kit sheet "Confirm it's you" and asks for proof from a method the account has (an authenticator code, a text code, or the password for an account with none); nothing is sent until it is given. The reference has no such step. It is the platform's §S7 gate on changing the number. Checked at 340 x 660 with the sheet open (ad hoc shot, not committed): the sheet sits over the screen with the timeline and field still readable behind it.
- **Cooldown message.** If a change has just been made, the first step says "Your number was changed a moment ago. To protect your account, you can change it again after <time>. If you didn't change it, contact support now." The platform holds a second change off for 15 minutes. An abandoned start does not count: only a completed change does.
- The done state says an SMS second-factor was switched off (and the printed backup codes, if it was the only second factor) and needs setting up again in Security.
- Re-shot after these changes: 15.88% differing pixels, unchanged (the first step is the one the harness can reach).
