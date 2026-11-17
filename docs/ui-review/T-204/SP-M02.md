# SP-M02 — Add or edit an address (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7864 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/addresses/0190b0a0-0000-7000-8000-000000000001
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 19,447 of 224,400 (8.67%)
- **Side by side:** `SP-M02.png` (reference · built · heat map) — **heat map:** `SP-M02.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- Shot on the **edit** route (`/account/addresses/<id>`) with the address filled in, because the reference draws the form filled. The add route is the same form empty.
- **Recipient name** is added: the platform requires it and the reference's form has no field for it. The reference's **Phone** is the recipient's phone, as on the platform.
- **City is a choice, and State is added.** The reference has a free-text City. The platform validates that the city is in the state named and is in the location catalog (`/geo/*`), so State and City are two selects, and City clears when State changes. **My city isn't listed** posts a city request (`POST /geo/city-requests`); until it is added the person picks the nearest city.
- **No map pin.** The reference draws "Drop a pin where the courier should stop". The platform holds no coordinates, so there is nothing to save a pin to; the landmark helper says what helps a courier instead.
- The default switch is the ui-kit `Toggle`. On an address that is already the default it is replaced by "This is your default address." (the platform has no way to un-default one; another address becomes the default instead).
- Editing sends only the fields that changed; clearing the landmark sends `null`.
- Every mutation on this screen sets `gcTime: 0` (an address is PII; TanStack keeps `variables` for five minutes otherwise), held by `packages/api-client/test/react/addresses.test.tsx`.
- Loading, the states failing to load, a missing address, offline, and a refused save are held by `test/addresses.test.tsx`, each with an axe pass.
