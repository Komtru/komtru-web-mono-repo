# SO1 — Tell Us About Your Business (T-121)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5411 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/sell/start
- **Code:** `apps/web-app-ui/src/sell/Start.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Address fields added.** Registered address, state and city are drawn here, though the reference does not draw them. Submit refuses without them (the backend's required fields).
- **Phone field not drawn.** The reference's WhatsApp/phone field has no field on the merchant application, so it would not save.
- **Verify-ID warning.** When the identity check is not done, the ready banner is replaced by a warning with a link to verification. The reference shows only the ready state.
- **Step count under the title.** `ScreenHeader` has no slot for the counter, so "1 / 5" sits on its own line under the title, not inline.
- **Sticky action.** Drawn with the ui-kit `StickyFooter` rather than `.btn-sticky`.
- **Loading, error and offline states added** (the reference draws none).
