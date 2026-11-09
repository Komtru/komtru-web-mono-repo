# Ticket index tooling

`pnpm tickets:index` rebuilds the index table in `docs/TICKETS.md` from the epic files in `docs/tickets/`.

Run it after changing any ticket's `**Status:**`, `**Depends on:**` or title. It:

- parses every `### T-xxx — Title` block and its status and dependencies;
- fails on a dependency that names an unknown ticket, or on a dependency cycle;
- recomputes each ticket's wave (earliest start), the critical path, and Ready/Waiting statuses;
- rewrites everything in `docs/TICKETS.md` from "## Critical path" down, keeping the hand-written header.

To mark a ticket done, add `- **Status:** Done (YYYY-MM-DD). Plan: <plan path>.` under its heading, then run the command.

## Progress

`pnpm progress` reports **features** first (`docs/tickets/FEATURE_MAP.md`): MVP and total bars, where only
`- **Status:** Done` counts. `--list` lists the remaining MVP features and the `Backend done, UI outstanding`
group, `--tickets` adds the per-ticket layer view, and `--write` regenerates `docs/PROGRESS.md`
(`pnpm progress:write`). The ticket view reads `docs/MVP.md`'s `## Included — N tickets` listings and fails
if they disagree with the stated counts. It is tested by `scripts/test/progress-tickets.test.ts`.
