# F-045 — Verify yourself, and close or recover an account (frontend, T-205)

Frontend layer only. The backend (T-039 account lifecycle, T-036 MFA and devices, T-050 verification) is merged.
Ten v2 screens: AS1, AS2, VF1, CA1, CA2, TF1, TF2, SP-M03, SP-M04, SP-M05. F-046 (the account shell) is not built; the
owner pulled these forward, so they extend the existing `/account` area and add no trust-history screens.

## Backend facts that shape the build (read from the route files, not assumed)

- `GET /me` carries everything AS1, AS2, CA1 and CA2 read: `account.status`, `abilities`, `openTrades` (a boolean or
  null, not a count), `canClose`, `supportReference`, `noticeKey`.
- `POST /me/close` takes `{ reason, password? , stepUpToken? }`; `reason` is one of four codes. Free text is not collected.
- MFA: TOTP enrol returns the seed and an `otpauth` URI once; activate returns the backup codes once (`null` when this is
  a second factor). Removing a factor and regenerating codes need a step-up token (`POST /me/step-up`, with a factor and
  code, or the password when the account has no factor).
- `GET /me/devices`, `GET /me/sessions` (page-paginated); `DELETE /me/sessions/:id` signs one device out.
- `GET /verification/status` returns the structured rejections (copy included) that VF1 renders; resubmission is
  `POST /verification/nin|bvn|liveness`.
- **There is no change-phone-number route and no `PATCH /me`.** SP-M05 cannot be completed against the platform; see
  Gaps below.
- There is no password-changed date and no app-lock concept on the web.

## Build order (each step test-first, committed green)

1. `@komtru/api-client`: `account.ts` endpoint contracts (additive) and `react/account.ts` hooks, with contract tests.
2. App seam: shared load states (loading, empty, error, offline), problem wording, routes and Account links.
3. SP-M04 Security & devices, with sessions and the factor list.
4. TF1 + TF2: authenticator setup (QR or typed key, six-digit code), backup codes shown once; regenerate with step-up.
5. SP-M03 Privacy & data: browser permissions in plain words, data export, erasure request.
6. CA1 + CA2: close your account; the open-trade block, the confirm sheet and sign-out.
7. AS1 + AS2: suspended, buyer and seller.
8. VF1: verification failed, with resubmit.
9. SP-M05: change number, to the extent the platform allows.
10. e2e (route-level render with axe) and visual check against the v2 reference; deviations recorded under
    `docs/ui-review/T-205/`.

## Gaps and decisions (updated after the review pass)

- SP-M05 is real: the identity module gained `POST /me/phone/change`, `/me/phone/change/confirm-current` and
  `/me/phone/change/confirm-new` (no migration; see `identity/services/phone-change.service.ts` for how the pending and retired
  numbers are held). Codes to both numbers, a notice to the old one.
- QR code: `qrcode-generator`, approved by the owner.
- AS1/AS2/CA1: "1 Trade in progress" and a trade row are not available (boolean only); the copy says "a Trade".
- AS1/AS2 say only what `abilities` backs; the reference's escrow, 48-hour and "with the reason" promises are dropped.
- "Contact TrustOps": there is no support screen in the app; the button shows the account's support reference.
- Accepted scope cuts: no text-message second-method setup UI; sequential session revoke.
- Not built: an automatic redirect of a suspended account to AS1/AS2 (middleware that knows account state).
