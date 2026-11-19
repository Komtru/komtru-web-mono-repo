# apps

Six deployables. `backend-api` has its own `CLAUDE.md`; everything below describes the five
frontends.

| App              | What it is                                      | Shipped?                               |
| ---------------- | ----------------------------------------------- | -------------------------------------- |
| `web-app-ui`     | consumer app — buy, sell, Park hub applications | yes, staging.komtru.com                |
| `operations-app` | TrustOps console                                | yes                                    |
| `web-site`       | public marketing site, komtru.com               | yes                                    |
| `logistics-ops`  | courier company portal                          | placeholder package, no dev server yet |
| `park-agent-app` | Park Agent custody app                          | placeholder package, no dev server yet |

## Shared conventions

- **Next.js 15, TypeScript, Tailwind**, one lint and format config for all of them, from
  `@komtru/config`.
- **Compose `@komtru/app-kit`**, don't re-implement it. It carries the auth route handlers, the
  scope middleware, Sentry wiring, the providers, the global stylesheet and the error screens.
- **Design tokens come from `@komtru/config/tailwind/preset.css`** and the `ui-kit`. One source
  for all of them — never redeclare a colour, radius, shadow or duration in an app.
- **Mobile is the baseline.** Breakpoints base → `sm` 640 → `md` 768 → `lg` 1024. Only layouts
  that genuinely change shape at width get a bespoke desktop treatment; tablet inherits the
  desktop shell with the sidebar becoming top nav. The buyer/seller flows and `park-agent-app`
  are mobile _web_ — browser chrome, not a native app bezel.
- **Run `pnpm env:apps` before the first start.** Copying `.env.example` by hand leaves
  `KOMTRU_SESSION_SECRET` empty and middleware then answers 500 on every page.
- **Never trust the client to say which company's or account's data it may see.** Scope every
  request server-side from the session.
- **Screens are checked against the reference.** `docs/design-reference/Komtru — UI Living
Master v2.html` is the source of truth for layout and components; find the screen in
  [SCREEN_INDEX.md](../docs/design-reference/SCREEN_INDEX.md), build it, then run
  `pnpm visual-check` and note any deviation before calling the work done.
- **TrustOps decisions follow one pattern** wherever they appear: an advisory box, the
  _"a human decides, always"_ divider, the action buttons, then the policy-cite footer. The
  pattern lives in `ui-kit`; don't rebuild it per screen.
- `@komtru/api-client` and `@komtru/shared-types` are consumed from their built `dist`, not from
  `src`. See [packages/CLAUDE.md](../packages/CLAUDE.md) — this is the single most common source
  of a phantom type error.
