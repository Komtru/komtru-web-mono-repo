# `@komtru/app-kit`

The Next.js foundation every Komtru app composes. Five pieces, one stylesheet, eight template files.

| Entry                        | What it is                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `@komtru/app-kit`            | isomorphic: `readAppConfig`, the sealed session cookie, the `md` shell-swap rule   |
| `@komtru/app-kit/next`       | `createKomtruMiddleware`, `komtruAuthRoute` — needs `next/server`                  |
| `@komtru/app-kit/react`      | `KomtruProviders`, `useApiClient`, `useSession` — a client boundary                |
| `@komtru/app-kit/sentry`     | `initSentry`, a no-op without a DSN                                                |
| `@komtru/app-kit/ui`         | `ErrorScreen`, `NotFoundScreen`                                                    |
| `@komtru/app-kit/styles.css` | the app's global stylesheet: tokens, preflight, element defaults, keyframes, focus |

## Wiring an app

Copy `templates/**` into the app, keeping the paths, and add one module of your own:

```
middleware.ts                      → scope enforcement on every navigation
instrumentation.ts                 → Sentry, server and edge
instrumentation-client.ts          → Sentry, browser
app/api/auth/[...action]/route.ts     → login, refresh, logout
app/error.tsx                      → inside the layout
app/global-error.tsx               → replaces the document, so it carries <html>, <body>, <main>
app/not-found.tsx
app/globals.css                    → imported once, from the root layout
src/app-config.ts                  → yours: the app's AppSpec (all four already have one)
```

Then add `KOMTRU_SESSION_SECRET` to `.env.local` — 32 characters or more, server-side only. Without
it the app refuses to start, which is the point: middleware cannot tell a real session from a
made-up one without it.

## How a session works

```
browser ──POST /api/auth/login──▶ route handler ──POST {api}/auth/login──▶ backend
                                       │
                                       ├── Set-Cookie komtru_rt       httpOnly, Path=/api/auth
                                       ├── Set-Cookie komtru_session  httpOnly, Path=/, HMAC-sealed
                                       └── 200 { accessToken, scope, expiresAt }   ← no refresh token
```

The access token lives in memory inside `@komtru/api-client`. On a 401 it calls
`/api/auth/refresh` — same origin, so `komtru_rt` rides along — and the route handler rotates both
cookies. No JavaScript ever sees a refresh token and nothing is written to `localStorage`.

`komtru_session` carries only `{ scope, expiresAt }`, sealed with HMAC-SHA-256, so middleware can
turn a consumer away from `ops.komtru.com` without a round trip. **It is a redirect, not an
authorization boundary.** The real check is the backend's, on every call. What the seal buys is that
the redirect's answer is honest: a cookie header is attacker-controlled whether or not it is
`httpOnly`, and an unsealed hint would mean middleware enforcing a value the caller chose.

## Why this is a package and not `ui-kit/src/next/**`

The ticket (T-017) left the choice open and asked for the reasoning.

**The dependency direction decides it.** The foundation needs `next`, `@sentry/nextjs`,
`@tanstack/react-query` and `@komtru/api-client`. `ui-kit` needs none of them: it is a component
library with no runtime dependencies, consumed by Storybook and by `tools/visual-check`, whose
`extract-tokens` entry points at raw TypeScript. Putting the foundation inside it would mean:

- `ui-kit` depends on `api-client` — and the error screen genuinely wants `ProblemError`, so this is
  not hypothetical. `api-client`'s React entry may later want `ui-kit`; that is a cycle waiting.
- every Storybook build, every parity test and every token extraction installs Sentry and Next.
- one package carries both a Vite/Storybook library and server-only route handlers, so its Vitest
  config needs two environments and its ESLint config needs the Next rules on files that are not.

**The cost of being wrong, in each direction.** Wrong as a package: one extra `package.json`, one
extra dependency line per app, and merging it back is a file move. Wrong inside `ui-kit`: every app
and every one of the sixteen web tickets has imported `@komtru/ui-kit/next`, so unwinding it is a
rename across all of them _plus_ removing Sentry, Next and `api-client` from a package that has had
them in its tree for twenty tickets. The costs are asymmetric by roughly an order of magnitude, and
the cheap mistake is the one to make.

## What this package deliberately does not do

- **It does not swap shells at runtime.** `SHELL_BREAKPOINT` (768, `md`) is the rule and
  `shellForWidth` applies it, but no component here renders one shell or the other. A Next server
  does not know the viewport width, so a runtime swap is either two shells around one page — the
  content in the DOM twice, two `<main>` landmarks, two copies of every form control — or a client
  boundary and a hydration flash around every screen. The app's layout applies the rule once, where
  it knows which route it is drawing.
- **It does not navigate on an app's behalf.** `KomtruProviders` takes `onSessionEnded`; what a
  dead session looks like is the app's decision.
- **It does not read the environment for you.** `readAppConfig` is called by the app, in the
  template, so the failure is at the app's boundary with a variable name in it.
