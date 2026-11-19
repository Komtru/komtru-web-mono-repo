# SO1 — Your business (T-121)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5411 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/account/verification/merchant/start
- **Code:** `apps/web-app-ui/src/sell/Start.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Frame title "Become a Seller" dropped.** The reference titles every step "Become a Seller". Owner correction (2026-11-19): every account is already a seller, so nothing becomes one. The frame reads "Your business", and the flow is merchant verification.
- **Lead paragraph added.** "Merchant verification is how your business becomes a merchant. Until then you sell as a default seller, and the amount you can transact is limited." The reference has no such line. It states the owner's model without a figure, because the cap is not built.
- **Back goes to the verification tab**, not to the account, so the way back is the tab the flow was entered from.
- **Address fields added.** Registered address, state and city are drawn here, though the reference does not draw them. Submit refuses without them (the backend's required fields).
- **Phone field not drawn.** The reference's WhatsApp/phone field has no field on the merchant application, so it would not save.
- **Verify-ID warning.** When the identity check is not done, the ready banner is replaced by a warning titled "Verify your ID first", with a link to the account's Verification section. The reference shows only the ready state.
- **Step count under the title.** `ScreenHeader` has no slot for the counter, so "1 / 5" sits on its own line under the title, not inline. The count keeps the reference's five screens, including SO5.
- **Sticky action.** Drawn with the ui-kit `StickyFooter` rather than `.btn-sticky`.
- **Loading, error and offline states added** (the reference draws none).
