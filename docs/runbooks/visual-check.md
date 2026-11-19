# Visual check without a backend

A screen ticket ends with a visual check (see [ui-review](../ui-review/README.md)). Running it on a real screen
needs the frontend built and served, a signed-in session, and, for a screen behind a flow, the clicks that reach
it. This runbook is the set of tools that does all of that with no database, no Redis, no Docker and no live
credential. A ticket does not hand-roll a stand-in for the platform, and it does not log in through the UI.

The pieces:

| Piece              | Command                             | What it does                                                                                   |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Platform stand-in  | `pnpm visual-standin`               | Serves the routes the frontends call, from typed fixtures. Port 7913.                          |
| Session seeder     | `pnpm visual-check --persona <p>`   | Signs the built app in as a persona with the app's own sealer. No UI login.                    |
| Walkthrough        | `pnpm visual-check --walk <screen>` | Takes the persona, data scenario, route and clicks for a screen from a registry.               |
| Comparison         | `pnpm visual-check`                 | Scores the built screen against the reference frame and writes the `docs/ui-review` record.    |
| Capture at a width | `pnpm visual-capture`               | A screenshot of a built screen at any width, with no reference. For tablet and desktop states. |

## One-time setup

```bash
pnpm install                 # in the worktree you work in
pnpm browsers:install        # Chromium for Playwright, once per machine
```

The frontend imports the workspace packages from their `dist`, so build what the app needs first. This builds
`@komtru/web-app-ui` and its dependencies, and needs the same env you will build the app with (below):

```bash
NEXT_PUBLIC_KOMTRU_API_URL=http://localhost:7913/v1 \
NEXT_PUBLIC_KOMTRU_SOCKET_URL=http://localhost:7913 \
NEXT_PUBLIC_KOMTRU_APP_URL=http://localhost:3913 \
pnpm -w exec turbo run build --filter=@komtru/web-app-ui...
```

## Run a check

Three terminals' worth, in this order. The ports are the harness defaults. If another agent holds one, change it
on both sides (`KOMTRU_VISUAL_STANDIN_PORT`, and the three `NEXT_PUBLIC_*` values with the app port).

1. **Start the stand-in.** It logs every request and every route it does not serve.

   ```bash
   pnpm visual-standin
   ```

2. **Build the app against it, then serve it.** `NEXT_PUBLIC_*` is baked in at build time, so the build must see
   the stand-in's URL. The session secret is read at run time and must match the seeder's.

   ```bash
   NEXT_PUBLIC_KOMTRU_API_URL=http://localhost:7913/v1 \
   NEXT_PUBLIC_KOMTRU_SOCKET_URL=http://localhost:7913 \
   NEXT_PUBLIC_KOMTRU_APP_URL=http://localhost:3913 \
   pnpm --filter @komtru/web-app-ui build

   KOMTRU_SESSION_SECRET=visual-check-standin-session-secret-0001 \
   NEXT_PUBLIC_KOMTRU_APP_URL=http://localhost:3913 \
   pnpm --filter @komtru/web-app-ui exec next start --port 3913
   ```

   A shell variable overrides the app's `.env.local`, so the app's own generated secret does not get in the way.
   The harness was proven against this production build. `pnpm dev` has not been checked against it.

3. **Check the screen.** For a screen with a registered walk, name it:

   ```bash
   pnpm visual-check --screen AC1 --walk http://localhost:3913
   ```

   For a screen that is a URL of its own, give the URL and the persona:

   ```bash
   pnpm visual-check --screen E4 --url http://localhost:3913/login                       # no session
   pnpm visual-check --screen U4 --url http://localhost:3913/trade/<id>/x --persona seller --scenario with-trades
   ```

The check writes `docs/ui-review/<ticket>/<screen>.md` (committed) and the `.png` and `.diff.png` beside it (not
committed, see [ui-review](../ui-review/README.md)). Open the `.png`: the reference, the built screen, and the heat
map. Then write the deviations under `## Deviations`.

## Capture a screen at a width

The reference frame sets the width of a comparison: 340px for a mobile screen, 560px for tablet, 1040px for desktop.
A state the reference does not draw, or a tablet treatment of a mobile screen, has no frame, so choose the width:

```bash
pnpm visual-capture --walk AC1 --app http://localhost:3913 --width 560
pnpm visual-capture --app http://localhost:3913 --path /trades --persona buyer --scenario no-trades --width 340
```

The shot goes to `test-results/visual-capture/` by default, which is git-ignored. `--height` defaults to 844 and sets
the viewport, not a full page.

## Personas and scenarios

The stand-in answers for four people. Each is a fixed identity with fixed facts (`tools/visual-check/src/standin/personas.ts`).

| Persona    | Scope    | Facts                        | Use it for                  |
| ---------- | -------- | ---------------------------- | --------------------------- |
| `buyer`    | CONSUMER | not sold, not a merchant     | Buyer screens, empty states |
| `seller`   | CONSUMER | has sold                     | Seller screens              |
| `merchant` | CONSUMER | has sold, certified merchant | Sell-only account screens   |
| `staff`    | STAFF    | none; no consumer routes     | Nothing yet (see limits)    |

A **scenario** is the data the persona sees. `with-trades` is the normal account: a funded trade and a pending
payment for the buyer, a shipped sale and a proposal for the seller. `no-trades` is the same person before a first
trade, which is the state the empty-state screens are drawn in. Default: `with-trades`.

The session is the app's own: the seeder seals `komtru_session` with `@komtru/app-kit` and sets `komtru_rt`
(`vc.<persona>.<scenario>`). Cookies ignore the port, so one seed serves every Komtru app on `localhost`. A session
the app does not accept redirects to `/login`, and the walk fails with a message saying so, rather than shooting a
sign-in form under a screen's name.

## Walkthroughs

A walk is data: a persona, a scenario, a route and the actions after it. It lives in
`tools/visual-check/src/walkthroughs.ts`:

An illustrative entry, not one that exists yet. The path is a placeholder and must be a real route:

```ts
CWT_S14: {
  screen: 'CWT-S14',
  persona: 'buyer',
  scenario: 'with-trades',
  path: '/trade/<a fixture trade id>/<route>',
  steps: [{ click: 'role=button[name="Report an issue"]' }],
},
```

Steps are Playwright selectors (`role=button[name="…"]`, `text=…`), run in order. A step that finds nothing fails
with its step number and the selector, so a screen reached by a different path than the one named is not shot. A
walk may set `content` (the shell-cropping selector, as `--content`).

Registered today: `AC1` (My Trades, empty). Add a row when a ticket needs a state the URL does not reach.
`tools/visual-check/test/walkthroughs.test.ts` checks every entry names a row of the v2 screen index.

## What the stand-in serves

The stand-in serves the routes below. Everything else answers 404 and is logged as `UNMATCHED` on the stand-in's
console. Read that log first when a screen looks wrong: it names the route the screen wanted.

| Method | Path               | Answers                                                         |
| ------ | ------------------ | --------------------------------------------------------------- |
| POST   | `/v1/auth/refresh` | Mints an access token for a `vc.` refresh token, and rotates it |
| GET    | `/v1/me/viewer`    | The persona's facts (`hasSold`, `certifiedMerchant`)            |
| GET    | `/v1/trades`       | The persona's trade list in the scenario, on one page           |

Socket.io is deliberately not served. The log marks it `NOT SERVED` rather than `UNMATCHED`.

The fixtures are typed against `@komtru/shared-types`. `checkFixtures()` parses every one with the real schema when
the stand-in starts, and a fixture that drifted from the contract stops the server with the field named. The apps
enforce the same schemas on what they receive, so a drifted fixture is caught here rather than as a blank screen.

To add a route, add a fixture in `fixtures.ts`, a route in `server.ts` and a case in `contracts.ts`, then a test in
`tools/visual-check/test/standin.test.ts`.

## Determinism

Two runs of the same screen against the same build should give the same shot. The harness holds these fixed:

- **Data.** Ids, names, amounts, dates and statuses are constants in `fixtures.ts`.
- **Clock.** When a session is used, the browser clock is pinned to 2026-11-19 09:00 UTC (`STANDIN_NOW_MS`). The
  timers keep running. A relative time on the screen ("2 days ago") reads the same every run.
- **Fonts and motion.** Fonts are injected on both sides, and animations and transitions are off (see
  [ui-review](../ui-review/README.md)).
- **Session.** The sealed cookie is deterministic: the same persona seals the same bytes.

The shots are deterministic on one machine, not across machines (Chromium's text rasterising differs by platform).

## What it cannot do yet

Be specific before you claim a screen. These were checked by loading the app against the stand-in:

- **Trade detail and every flow inside a trade.** `GET /v1/trades/:id` is not served, so `/trade/<id>` shows the app's
  error state. That covers the Trade Workspace (`CWT-*`), the cancellation, fulfilment, evidence and dispute screens,
  and the trade-by-code page. This is the largest gap, and the next route to add.
- **Account, payouts, verification, two-factor and privacy.** These call routes under `/me` and `/verification`,
  none of which is served. Screen-by-screen, these are unchecked: a probe of `/account` drew an `UNMATCHED GET /v1/me`
  in the log, and nothing else was tried.
- **Sign-in, sign-up, verification and the first-run walkthrough** (the entry screens `E1`–`E4`, and the terms and
  onboarding screens). The seeder skips login, and `POST /v1/auth/login` is not served. `E4` (Log In) can still be
  shot with no session, because it is a public page, and it scores 0.84%. A screen that submits a form cannot be
  driven to its result.
- **Failure, loading and offline states.** The stand-in only answers with success or a 404 for a route it does not
  serve, so a 500, a timeout or a 403 on a real route cannot be produced on purpose. The offline screen (`OF1`) needs
  the network taken down, and no walk does that yet.
- **Realtime.** Socket.io is not served, so a screen that updates when a trade moves shows its first state only.
- **Staff and logistics.** The `staff` persona exists, but the stand-in serves no staff routes, and web-app-ui refuses
  a `STAFF` session. The operations app, the logistics app and the Park Agent app have not been run against the
  stand-in at all.
- **Seller and merchant data beyond the trade list.** The seller and merchant personas share one two-trade list,
  from the seller's side. Any screen that reads more of a seller's data is unserved.
- **Desktop and tablet of a mobile screen that has a reference frame.** `pnpm visual-check` always uses the frame's
  width. `pnpm visual-capture` shoots any width, but it compares nothing.

Be precise about the proof. The screen proven end to end is `AC1` (T-113, My Trades, empty state), recorded in
`docs/ui-review/T-113/AC1.md`. Its deviations (copy, one of two actions, the brand mark and the header control, and a
14px vertical offset) are real, and whether the copy or the reference wins is the owner's call.

## Troubleshooting

| Symptom                                                        | Cause and fix                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Could not open http://localhost:3913/… — is the app running?` | Nothing is serving the app. Start it with `next start` (step 2).                                                                                       |
| `the app sent the … session to /login`                         | The app did not accept the seed. Start it with `KOMTRU_SESSION_SECRET=visual-check-standin-session-secret-0001`, and rebuild against the stand-in.     |
| `Nothing on … matches --content main`                          | The page has no `<main>`, or it has not rendered yet. Drop `--content` for that screen.                                                                |
| `No walkthrough for X`                                         | No registry row. Add one, or pass `--persona` with `--url`.                                                                                            |
| `Stand-in fixtures no longer match @komtru/shared-types`       | A contract changed. Update the named fixture in `fixtures.ts`.                                                                                         |
| Many `UNMATCHED` lines in the stand-in log                     | The screen calls routes that are not served. See _What it cannot do yet_.                                                                              |
| A `401` in the stand-in log                                    | Expected once per page: the app calls with no token, gets a 401, then refreshes. A 401 that repeats means the session was not seeded for that persona. |
| `visual-standin: could not start on port 7913: … EADDRINUSE`   | Another process holds the port. Pick a free one with `KOMTRU_VISUAL_STANDIN_PORT`, and change the app's three `NEXT_PUBLIC_*` values to match.         |

## Security

The stand-in and the seeder never read `docs/specs/backend-apis.env`, and never print a value from a `.env` file.
The session secret in the harness is a fixed value for local checks, not a credential: it is in the repository on
purpose, so two runs agree. Do not point the stand-in at a real backend, and do not use the harness's cookies
against a deployed host. Run the stand-in only on `localhost`.
