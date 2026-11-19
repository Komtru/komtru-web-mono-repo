# Komtru

Komtru is an escrow marketplace: buyers and sellers trade with their money held in escrow until delivery is confirmed. This monorepo holds the backend API, the four frontends and their shared packages.

## Layout

| Path                    | What it is                                                 | Domain               |
| ----------------------- | ---------------------------------------------------------- | -------------------- |
| `apps/backend-api`      | Express API and BullMQ worker                              | api.komtru.com       |
| `apps/web-app-ui`       | Consumer app for buying, selling and Park hub applications | app.komtru.com       |
| `apps/operations-app`   | TrustOps console                                           | ops.komtru.com       |
| `apps/logistics-ops`    | Courier company portal                                     | logistics.komtru.com |
| `apps/park-agent-app`   | Park Agent custody app                                     | park.komtru.com      |
| `packages/config`       | Shared TypeScript, ESLint, Prettier and Vitest presets     | —                    |
| `packages/shared-types` | zod schemas and types shared by backend and frontends      | —                    |
| `packages/ui-kit`       | Design tokens, brand mark and components                   | —                    |
| `packages/api-client`   | Typed API client                                           | —                    |
| `docs/`                 | Design, tickets, reference specs and the UI reference      | —                    |

Most apps are still placeholders. Each one is built out by its own ticket in [docs/TICKETS.md](docs/TICKETS.md).

## Prerequisites

- Node 22 (see `.nvmrc`; 22.12 or newer)
- pnpm 10 (`corepack enable` picks up the pinned version)

## Local services

`pnpm infra:up` starts Postgres, PgBouncer, Redis and Mailpit in Docker, and `pnpm env:backend` writes the backend's `.env`. The [local development runbook](docs/runbooks/local-dev.md) covers both, including the credentials file you need first.

## Run the apps

```bash
pnpm dev            # every app with a dev server, in one terminal
```

`pnpm dev` builds the shared packages first, then starts the API, the BullMQ worker and the Next dev servers together and keeps them running. Stop them all with Ctrl-C.

Three things have to be in place before the first run, all covered by the [local development runbook](docs/runbooks/local-dev.md):

1. `pnpm infra:up` — without Postgres and Redis the API and worker fail on startup.
2. `pnpm env:backend` — writes `apps/backend-api/.env`.
3. `pnpm env:apps` — writes each frontend's `.env.local` from its `.env.example`, generating the `KOMTRU_SESSION_SECRET` a committed example cannot carry. Copying the example by hand instead leaves that value empty, and middleware then answers 500 on every page.

| Process                   | Address                  |
| ------------------------- | ------------------------ |
| `apps/backend-api` API    | http://localhost:7813    |
| `apps/backend-api` worker | no port; BullMQ consumer |
| `apps/web-app-ui`         | http://localhost:3001    |
| `apps/operations-app`     | http://localhost:3002    |
| `apps/web-site`           | http://localhost:3005    |

`apps/logistics-ops` and `apps/park-agent-app` are still placeholder packages with no dev server, so `pnpm dev` skips them; they join it when their tickets turn them into Next apps.

`apps/web-site` is the public marketing site — komtru.com, the pages someone reads before they have an account. It is a separate app rather than routes inside `web-app-ui` because it shares almost nothing with the product: no session, no service worker, no API client. It takes the design tokens and the three typefaces from `ui-kit`, and calls exactly one backend route, `POST /v1/waitlist`.

To start a subset:

```bash
pnpm dev:api        # API and worker only
pnpm dev:web        # the Next apps only
pnpm turbo run dev --filter=@komtru/web-app-ui   # one app
```

## Commands

Run from the repository root.

```bash
pnpm install        # install every workspace; also installs git hooks
pnpm dev            # start every app's dev server (see above)
pnpm lint           # ESLint with type information, every workspace
pnpm typecheck      # tsc --noEmit, every workspace
pnpm test           # Vitest in every workspace, then repository checks
pnpm build          # build every workspace
pnpm format         # Prettier
```

Run one workspace with Turbo's filter, for example `pnpm turbo run test --filter=@komtru/backend-api`.

## Conventions

- Commit messages follow Conventional Commits, enforced by a git hook (`feat(identity): add login`).
- `docs/specs/backend-apis.env` contains live credentials. It is git-ignored, and the pre-commit hook fails if it ever stops being ignored. Never commit `.env` files; commit `.env.example` instead.
- Work happens one ticket at a time in its own git worktree, following the process at the top of [docs/TICKETS.md](docs/TICKETS.md). Nothing is pushed to a remote until every ticket is done.

## Design and planning

- [Platform design](docs/superpowers/specs/2026-10-05-komtru-platform-design.md)
- [Ticket list](docs/TICKETS.md)
- [UI reference screen index](docs/design-reference/SCREEN_INDEX.md)
