# web-site

The public marketing site at komtru.com — the pages someone reads before they have an account.
Port 3005. Deployed by the Vercel project `komtru-web-site` (root `apps/web-site`, production
branch `main`).

It is a separate app rather than routes inside `web-app-ui` because it shares almost nothing
with the product: **no session, no service worker, no API client.** It takes the design tokens
and the three typefaces from `ui-kit`, and calls exactly one backend route.

## Rules specific to this app

- **`ring` is not available as a class name here.** Tailwind generates a `ring` utility that
  paints a 1px box-shadow around whatever carries it. This cost an hour once.
- **The palette is not its own.** `app/site.css` is the reference design ported with every
  colour replaced by a `@komtru/config/tailwind/preset.css` token. They are identical by value,
  so never reintroduce the reference's `:root` block.
- **One backend call: `POST /v1/waitlist`.** The backend's `ALLOWED_ORIGINS` must name this
  site's origin or the browser blocks it silently, with nothing in the server log.
- Don't add a session, an api-client dependency or a service worker. If a page seems to need
  one, it probably belongs in `web-app-ui`.

## Design source

`~/Downloads/Komtru website v4.2.html` — one 1.9MB hash-routed file holding sixteen pages. It is
**not in the repo**. Strip `<svg>`, `<script>`, `<style>` and base64 before reading it; that
takes it from 1.9MB to about 47KB of markup. The weight is app-screen mockups, their CSS and a
1MB city sprite sheet, none of which you need to read the copy and layout.

Phase 1 (home and chrome) and phase 2 (the other twelve routes) are done — every route in the
header and the footer is now its real page, and `ComingSoon` is deleted. The app-screen player
is phase 3 and deliberately absent: where the reference puts a `.pw` phone mockup beside copy,
those bands are single-column, each with a comment saying why.

Four blocks recur across those pages and live in `src/chrome/Blocks.tsx` — `Checks`, `InfoBox`,
`Steps` and `IconTile`. Compose them; don't re-write `.cks`/`.info`/`.sp`/`.icn` markup per page.
Page-private widgets (the fee calculator, the comparison table, the hub chips, the badge
explainer) keep their CSS in a `*.module.css` beside the page rather than in `app/site.css`.
