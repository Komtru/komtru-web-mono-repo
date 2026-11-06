# T-140 Console scaffold, shell and staff auth: implementation plan

Ticket: `docs/tickets/14-operations-app.md` (T-140). Screens: OP-28 (Welcome), OP-33 (My account); staff login, MFA and invitation acceptance have no reference screen. Reference markup read at `docs/design-reference/SCREEN_INDEX.md` lines 296, 323, 328 (OP-01 shell, OP-28, OP-33).

## Shape

`apps/operations-app` becomes a Next.js 15 App Router app on port 3002, wired the way `web-app-ui` is (T-017): `@komtru/app-kit` middleware, auth route, Sentry, providers and stylesheet; `@komtru/ui-kit`'s `ConsoleShell` for the chrome; `@komtru/api-client` for every platform call.

### Backend facts that decide the design

- Staff sign-in is two public routes: `POST /auth/staff/login` (password, answers `{ mfaRequired, mfaToken, factors }`, never a session) and `POST /auth/staff/mfa/verify` (`mfaToken`, `factorId`, `code`, answers the session). `POST /auth/mfa/challenge` sends an SMS or email code for a factor first.
- `app-kit`'s auth route handler only understood a session body from the login path, so a challenge answer became a 502, and it had no second-factor action. T-140 extends it: a login answer that is a challenge passes through (it carries no token, so no cookie), and two new actions, `mfa` and `mfa-challenge`, proxy the second step; the `mfa` action issues the session and cookies exactly as login does, wrong-scope check included. Paths are options (`mfaVerifyPath`, `mfaChallengePath`) so a consumer app keeps `/auth/mfa/*` and the console passes `/auth/staff/*`.
- Staff invitation acceptance (T-038) is a **CONSUMER** call: `POST /me/staff-invitations/start` then `/accept`, made by the signed-in account whose verified primary email is the invited address. The console's auth route refuses a CONSUMER session, so `/api/invitation/*` is `createAuthRouteHandlers` in token mode against the consumer backend routes: sign-in (needs an invitation token in the body, 400 otherwise), `mfa`, `mfa-challenge` and `release`. It returns an access token only and sets no cookie; the refresh token waits in a server-side store and is revoked by `release` when the flow ends (second factor on, or a terminal failure) or by a sweep when the page is abandoned. A consumer account with two-step sign-in on gets the second-factor step before acceptance. The invitation token travels in the URL fragment and is stripped once read; `/invite?token=` forwards to `/welcome#token=`.
- Every app-kit auth POST (login, mfa, mfa-challenge, logout, release) needs `application/json` and a same-origin `Origin` (else `Referer`), forwards the caller's `X-Forwarded-For` and user agent to the backend, and sits behind a coarse in-memory per-IP and per-identifier limiter. The backend's `TRUST_PROXY_HOPS` must count the proxies in front of the console, not the console. Limiter and refresh store must move to Redis behind more than one instance.
- No endpoint returns the signed-in staff member's own roles and permissions. The console reads `GET /admin/me` (api-client endpoint `getStaffMe`) which the backend does not have yet; until it does the viewer has no permissions and the sidebar is empty (deny by default). Recorded as a missing backend endpoint for a follow-up identity ticket.

### Navigation and permissions

`src/shell/nav.ts` is the one table: the ticket's twelve sections, each with a path, an icon and a permission (`PermissionCode`, copied as a const list from the T-037 catalog and held to it by a test that parses the backend catalog file). An item shows when the viewer holds **any** of its permissions. Mapping documented in `docs/ui-review/T-140/NAV-PERMISSIONS.md`.

### STAFF scope

`middleware.ts` is `createKomtruMiddleware` with the app's `STAFF` spec and the public paths `/sign-in`, `/invite` and `/api/invitation`. A missing or lapsed session goes to `/sign-in?next=`, a session of another scope to `/sign-in?error=wrong-scope`, cookies cleared either way. The backend remains the authorization boundary.

### Pages

`/sign-in` (password, then second factor), `/invite` (token from the link, consumer sign-in, emailed code, accept), `/welcome` (OP-28: the six steps, step 2 draws TOTP enrolment against `/me/mfa/totp/*`), `/me` (OP-33: roles, permission count, two-step sign-in state, sign out), and one placeholder per nav section. `/` redirects to `/queue`.

## Steps (test first, commit after each green step)

1. `app-kit`: auth route challenge pass-through, `mfa` and `mfa-challenge` actions; api-client `authRoutePaths` gains them; README line.
2. `api-client`: endpoints `getStaffMe`, `startStaffAcceptance`, `acceptStaffInvitation` and the staff-me schema.
3. `operations-app` scaffold: package.json, Next config, layout, middleware, auth route, error and not-found, replace the T-017 stub.
4. Navigation table and permission filtering, with the catalog-parity test.
5. Middleware tests (STAFF passes, CONSUMER and anonymous redirected, public paths open).
6. Shell (`ConsoleFrame`, viewer hook), placeholder pages.
7. Sign-in and MFA, invitation acceptance, welcome, my account; component tests.
8. Visual comparison notes under `docs/ui-review/T-140/`, status line, full verification: lint, typecheck, test, build, `pnpm format:check`.

## Deviations, decided up front

- The ticket's twelve-section sidebar replaces OP-01's nine-item rail (Today, My work, Trades, Money, Custody, People, Cases, Search and audit, Team and access); the ticket is the acceptance criterion.
- OP-33's Trusted devices and My shift panels need endpoints that do not exist (device list, shift roster); they are left out rather than faked.
- OP-28's steps 3 to 6 have no backend; they are drawn in their reference state (pending) with nothing to act on.
