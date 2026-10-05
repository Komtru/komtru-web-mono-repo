# Build-agent setup

What a session needs before it can work on UI tickets. Backing services are a separate concern — see
[local-dev.md](local-dev.md).

## 1. The `frontend-design` skill

Every screen ticket invokes this skill per screen (master prompt STEP 4), so it has to be installed
in the Claude Code session doing the work, not just mentioned in the plan.

```bash
claude plugin install frontend-design@anthropic-plugin-directory
claude plugin details frontend-design@anthropic-plugin-directory   # confirms it resolves
```

Installed at user scope on 2026-10-05: one skill, `frontend-design`, ~78 tokens always-on and ~2.7k
per invocation. A plugin enabled mid-session becomes available in the **next** session, so start a
fresh session before the first screen ticket.

The master prompt names the plugin as `anthropics/claude-plugins-official`, path
`plugins/frontend-design`. That repository is published through the built-in
`anthropic-plugin-directory` marketplace, which is where the command above gets it; there is no
separate marketplace to add.

## 2. Playwright browsers

The visual-check harness (T-016) screenshots each built screen beside its reference section, which
needs the browser build matching the pinned Playwright.

```bash
pnpm browsers:install   # playwright install chromium
pnpm test:browser       # launches it and takes a screenshot, so "installed" is proven, not assumed
```

`@playwright/test` is pinned at the repository root (exact version, like every other dependency).
Browsers live in `~/Library/Caches/ms-playwright` on macOS and are not part of the repository, so
every machine and every CI runner installs them itself. `pnpm test` does not run the browser test:
it is gated on `KOMTRU_BROWSER_TESTS=1` so a fresh checkout without browsers still goes green.

## 3. The screen index

`docs/design-reference/SCREEN_INDEX.md` maps all 210 screens in the reference HTML to one app and
one ticket each, with the line in the HTML where each screen starts — which is how the visual-check
harness finds the section to compare against.

```bash
pnpm test:repo   # includes scripts/test/screen-index.test.ts
```

That test re-derives the screens from the HTML and fails on any drift in id, name, line, app or
ticket, so the index cannot quietly rot as the reference or the ticket list changes. Two
normalisations are deliberate and encoded in the test: the reference numbers the customer and seller
tab screens `1`–`10` while the index prefixes them `C` and `S` to keep ids unique, and `TO-PA10`
appears twice as two variants of one screen.

`logistics-ops` has no screens in the reference at all. That is expected — Epic 15 says so, and its
visual check is design-system conformance rather than screenshot-vs-reference.

## 4. Running two agents against one stack

The Docker stack is a single Postgres and a single Redis, but the backend's test harness no longer
assumes it owns them. Two worktrees can run `KOMTRU_INFRA_TESTS=1` at the same time as long as each
names its own database prefix and its own Redis logical database:

```bash
KOMTRU_INFRA_TESTS=1 \
KOMTRU_TEST_DB_PREFIX=komtru_t031 \
KOMTRU_TEST_REDIS_URL=redis://localhost:56379/2 \
  pnpm exec vitest run
```

Without them the harness uses `komtru_test_*` and Redis database 0, and two concurrent runs fight
over the same template database — one drops it while the other is cloning from it. The prefix also
makes leftovers obvious: `DROP DATABASE` anything matching your prefix when you are done.

Redis database 0 belongs to the local dev app. Give each parallel run a number from 1 to 15.
