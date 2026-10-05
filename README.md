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

## Commands

Run from the repository root.

```bash
pnpm install        # install every workspace; also installs git hooks
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
