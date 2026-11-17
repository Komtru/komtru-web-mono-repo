# F-044 — Account basics, addresses, documents and system states (T-204) — plan

Frontend only; the backend (T-042, T-046, ledger reads) is merged. Built on the F-037/F-045 account shell in
`apps/web-app-ui`, ahead of its formal parents F-030 and F-046 (owner's call, as F-045). Test-first, a commit per green step.

## What the platform gives, and so what each screen can honestly be

| Screen                     | Data                                                        | Decision                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-M01 Saved addresses     | `GET /me/addresses`, `POST .../default`, `POST .../archive` | List, make default, remove (archive; there is no DELETE client).                                                                                                                        |
| SP-M02 Add or edit         | `POST/PATCH /me/addresses`, `/geo/*`                        | The platform's fields (recipient, state, city selects), not the reference's free-text city and map pin. Mutations `gcTime: 0` (PII). "My city isn't listed" posts `/geo/city-requests`. |
| SP-M33 Display             | none (device preferences)                                   | localStorage + `data-*` on `<html>` + CSS.                                                                                                                                              |
| SP-M11 Receipt & documents | `GET /trades/:id` (terms, fee snapshot) + evidence count    | Per-trade screen; receipt is drawn on the page and printed/saved as PDF by the browser. There is no PDF service.                                                                        |
| SP-M12 Where's my refund   | `GET /me/refunds`                                           | A journey per refund from status and dates; honest empty state (F-030 not built).                                                                                                       |
| SP-M13 Statements          | `GET /me/payouts`, `GET /me/refunds`                        | CSV built in the browser from those two lists, for a period. No trades/payments list exists for it, so it says what it includes.                                                        |
| SP-M14..M19                | not data-backed                                             | Each wired to its trigger; see below.                                                                                                                                                   |

## System states: how each is reached

- M16 session expired: `onSessionEnded` (a refresh that returned null) goes to `/session-expired?next=`, not straight to `/login`.
- M17 too many attempts: a 429 on sign-in, the second factor and the code check renders the screen in place, with the platform's `Retry-After`.
- M18 camera permission: shown inside the proof camera sheet before the browser prompt when permission is not yet granted.
- M19 link expired / trade not found: a 404 on trade-by-code, on the trade gate, and the app `not-found`.
- M14 service notice: a 503 from any API read raises a banner in the shell linking to `/status`; `/status` probes the platform health route and reports what it finds.
- M15 update required: an API 426 sends to `/update-required` (Update now clears the offline cache and reloads). The backend emits no 426 today: wired, dormant, reported.

## Steps

1. api-client: `gcTime: 0` on address mutations; `useSubmitCityRequest`; tests.
2. nav items (Addresses, Refunds, Statements, Display) and icons.
3. SP-M01/M02 addresses.
4. SP-M33 display preferences.
5. SP-M12 refunds.
6. SP-M13 statements.
7. SP-M11 documents.
8. System states and their triggers.
9. axe on every screen including non-initial states; visual check and `docs/ui-review/T-204/`.
