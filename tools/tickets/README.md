# Ticket index tooling

`pnpm tickets:index` rebuilds the index table in `docs/TICKETS.md` from the epic files in `docs/tickets/`.

Run it after changing any ticket's `**Status:**`, `**Depends on:**` or title. It:

- parses every `### T-xxx — Title` block and its status and dependencies;
- fails on a dependency that names an unknown ticket, or on a dependency cycle;
- recomputes each ticket's wave (earliest start), the critical path, and Ready/Waiting statuses;
- rewrites everything in `docs/TICKETS.md` from "## Critical path" down, keeping the hand-written header.

To mark a ticket done, add `- **Status:** Done (YYYY-MM-DD). Plan: <plan path>.` under its heading, then run the command.
