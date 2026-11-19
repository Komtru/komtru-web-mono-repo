# Komtru

Komtru is an escrow marketplace: buyers and sellers trade with their money held until delivery is
confirmed. This monorepo holds the backend API, five frontends and their shared packages.
[README.md](README.md) has the path-by-path layout, the ports and the first-run steps.

This file is the always-on core. Everything else loads on demand: each app and package tree has
its own `CLAUDE.md` that arrives when you touch a file there, and the table at the bottom routes
you to the right document for the task in front of you. Follow a link when its row applies —
don't read ahead.

## Hard rules

- **Branch off `staging`, merge to `staging`, push.** That deploys the staging apps and the
  staging backend. **`main` is released only when the owner asks for it.** Never push to `main`
  otherwise — not to tidy up, not because staging is green, not because a fix looks urgent. A
  push to `main` deploys komtru.com and the production backend at api.komtru.com.
- **Conventional Commits**, enforced by a git hook. Start the subject with a lower-case verb,
  keep the header under 100 characters, and don't use `wip` as a type. Merge commits need a
  conventional message too — `chore(merge): merge F-0xx <lower-case summary>` — because
  commitlint rejects git's default `Merge …`.
- **Never commit a `.env`.** `docs/specs/backend-apis.env` holds live credentials, is git-ignored
  and exists only in the main checkout. Never print its values in a log, a PR body or a reply.
- **The unit of work is the feature** in [FEATURE_MAP.md](docs/tickets/FEATURE_MAP.md), not the
  T- ticket. A feature is **Done** only when a user can do the thing in an app. Backend alone
  never closes one, and neither does UI over stubs.
- **Never guess on a money rule.** Ship the documented default if there is one; otherwise park
  the question for the owner in `docs/manager/RUN_LOG.md`.
- **Report progress at the end of a build run**: the two `pnpm progress` feature bars, MVP and
  total, then one line per feature touched.

## Commands

Run from the repository root. When the shell is inside a worktree or a package directory,
prefix with `pnpm -w exec` — otherwise `turbo` and `prettier` silently cover only that package.

| Command                                      | What it does                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm infra:up`                              | Postgres, PgBouncer, Redis and Mailpit in Docker                                                       |
| `pnpm env:backend` / `pnpm env:apps`         | write the backend `.env` and each frontend `.env.local`                                                |
| `pnpm dev`                                   | every app's dev server; `pnpm dev:api` and `pnpm dev:web` for subsets                                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | whole repo. Add `--force` when verifying a merge: turbo's cache is shared across worktrees             |
| `pnpm migration:safety`                      | required before any deploy carrying a migration                                                        |
| `pnpm visual-check`                          | the built screen against the UI reference                                                              |
| `pnpm progress` / `pnpm progress:write`      | feature progress. Never run `progress.py --write` on its own — only the pnpm script also runs prettier |
| `pnpm tickets:index`                         | regenerates `docs/TICKETS.md`. Orchestrator only; it conflicts across parallel branches                |

## Where to look

| If you're…                                       | Read first                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| working a feature or a ticket                    | [FEATURE_MAP.md](docs/tickets/FEATURE_MAP.md), then _How each ticket is worked_ in [TICKETS.md](docs/TICKETS.md)                                 |
| running the scheduled build manager              | [docs/manager/MANAGER.md](docs/manager/MANAGER.md)                                                                                               |
| running two or more agents at once               | [Parallel work](docs/conventions/parallel-work.md) — shared Postgres, Redis and migration numbering force some of it to serialise                |
| setting up locally, or infra won't start         | [local-dev.md](docs/runbooks/local-dev.md), [dev-setup.md](docs/runbooks/dev-setup.md)                                                           |
| deploying, or a deploy job failed                | [deploy-backend.md](docs/runbooks/deploy-backend.md)                                                                                             |
| touching fees or any money constant              | [config/fees.yaml](config/fees.yaml), [fees.md](docs/runbooks/fees.md)                                                                           |
| building or changing a screen                    | [SCREEN_INDEX.md](docs/design-reference/SCREEN_INDEX.md) and `docs/design-reference/Komtru — UI Living Master v2.html`, then `pnpm visual-check` |
| chasing a test that only fails in the full suite | [Testing](docs/conventions/testing.md) — it is almost always cross-file interference, not slowness                                               |
| removing evidence from a trade                   | [trade-evidence-removal.md](docs/runbooks/trade-evidence-removal.md)                                                                             |
| asking why the plan is shaped this way           | [BUILD_PLAN.md](docs/BUILD_PLAN.md), [platform design](docs/superpowers/specs/2026-10-05-komtru-platform-design.md)                              |
| curious how the build began                      | [MASTER_BUILD_PROMPT.md](docs/MASTER_BUILD_PROMPT.md) — the origin prompt, kept for history. Where it disagrees with this file, this file wins   |
