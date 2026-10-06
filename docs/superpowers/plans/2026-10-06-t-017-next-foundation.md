# T-017 — Next.js app foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One package every Komtru Next app composes — auth route handlers that own the refresh cookie, middleware that enforces the app's session scope, Sentry, the global stylesheet, the Query and realtime providers, and the error and not-found screens — plus the two cross-cutting rules T-013 and T-014 left to this ticket.

**Architecture:** A new workspace package, **`packages/app-kit`** (`@komtru/app-kit`), not `packages/ui-kit/src/next/**`. The reasoning and its cost are Task 12's deliverable; the short version is dependency direction. The foundation needs `next`, `@sentry/nextjs`, `@tanstack/react-query` and `@komtru/api-client`; `ui-kit` today needs none of them, is consumed by `tools/visual-check` and by Storybook, and its error screen would have to import `ProblemError` from `api-client` — making `ui-kit` depend on the client that may later want to depend on `ui-kit`. Entry points are split the way `api-client` splits its own, so a Server Component never pulls in React-only or Next-only code: `.` (isomorphic), `./next`, `./react`, `./sentry`, `./ui`, `./styles.css`.

**Tech Stack:** Next.js 15.5.27, React 19.3.0, `@sentry/nextjs` 11.4.0 (matching the backend's `@sentry/node` 11.4.0), `eslint-config-next` 15.5.27, `eslint-plugin-react-hooks` 7.1.1, Tailwind CSS 4.3.3, Vitest 5.0.3, Zod 4.6.5. Web Crypto (`crypto.subtle`) for the session seal, because middleware runs in the Edge runtime.

**Spec:** `docs/tickets/01-shared-packages.md` § T-017, plus the two items passed to it from § T-013 and § T-014 (`md` as the shell-swap boundary; the missing global line-height) and the three items passed from § T-011 (`@keyframes shimmer`, `@keyframes nodePulse`, the global `:focus-visible` rule and the reference's element defaults).

## Global Constraints

- Exact dependency versions. No `^`, no `~`, anywhere.
- TypeScript strict; ESM; `.js` extensions on every relative import.
- `@komtru/config` presets only: `komtruEslint`, `defineKomtruVitest`, `@komtru/config/tsconfig/*`.
- No raw hex anywhere in TS/TSX (`komtru-design/no-raw-hex`). Colour comes from `ui-kit` tokens.
- Screens are built from `ui-kit` tokens, primitives and shells; no local copies of shared components.
- Conventional commits, lower-case verb first in the subject (commitlint rejects sentence case).
- **No drizzle migration in this branch.** Another agent owns `0029` this wave.
- **Never set `KOMTRU_INFRA_TESTS=1`; never run `pnpm infra:up`/`infra:down`; never run `pnpm tickets:index`.** Postgres and Redis are shared with other agents right now.
- Turbo's cache is shared across worktrees: every verification run uses `--force`.
- `eslint .` lints `storybook-static/` if a Storybook build has been run. Delete `packages/ui-kit/storybook-static` before linting.
- Copy is sentence case, active voice, no apology, and says what is safe and what to do next — the voice of the reference's own failure screens (WF1 l.6263, U5 l.6518).

## Review Focus

1. **A tampered, truncated or garbage session cookie must not throw.** Middleware runs on every navigation; an exception there is a 500 on every page of the app. `open()` returns `null` for anything it cannot verify. — Tasks 3 and 4.
2. **A backend 500 on refresh must not sign the user out.** Only a 401 means the credential is gone; treating a hiccup as a sign-out logs out everyone at once. This is the rule `createRouteHandlerRefresh` already follows on the client side and the route handler has to match it. — Task 5.
3. **Two tabs refreshing the same token must not kill the session family.** M1 D5's reuse detection revokes the family on a replayed refresh token, and T-031 recorded the mitigation as this ticket's. — Task 5.
4. **A login that returns the wrong scope must not leave a live session behind.** Rejecting with a 403 and keeping the backend session the login just minted is a session nobody owns. — Task 5.
5. **`Secure` on a plain-http `localhost` dev server silently drops the cookie**, so nobody can sign in locally and nothing says why. Secure is on everywhere except a plain-http loopback request. — Task 3.

---

## File structure

```
packages/app-kit/
  package.json  tsconfig.json  tsconfig.build.json  eslint.config.mjs  vitest.config.ts  README.md
  src/
    index.ts        isomorphic barrel: config, session, layout
    config.ts       AppSpec -> AppConfig, read from env, fails naming the variable
    session.ts      the sealed scope hint + the two cookies and their attributes
    layout.ts       the md shell-swap rule
    sentry.ts       sentryOptions / initSentry, no-op without a DSN
    styles.css      the app's global stylesheet (the line-height rule lives here)
    next/index.ts   next-only barrel
    next/middleware.ts
    next/auth-routes.ts
    react/index.ts  'use client' barrel
    react/providers.tsx
    ui/index.ts  ui/ErrorScreen.tsx  ui/NotFoundScreen.tsx
  templates/        the per-app files a scaffold ticket copies, verified by test
  test/
apps/{web-app-ui,operations-app,logistics-ops,park-agent-app}/
  src/app-config.ts   the app's own AppSpec
  test/app-config.test.ts
  .env.example        gains KOMTRU_SESSION_SECRET
packages/config/eslint/index.mjs        gains the Next and React rules
packages/config/test/eslint.test.ts     and the tests for them
.github/workflows/{four apps}.yml       path filters follow the new dependency edges
```

---

### Task 1: Next.js and React lint rules in `komtruEslint`

**Files:**

- Modify: `packages/config/eslint/index.mjs`
- Modify: `packages/config/package.json` (add `eslint-config-next` `15.5.27`, `eslint-plugin-react-hooks` `7.1.1` to `dependencies`)
- Create: `packages/config/test/fixtures/react/conditional-hook.tsx`, `packages/config/test/fixtures/react/img-element.tsx`, `packages/config/test/fixtures/react/clean.tsx`, `packages/config/test/fixtures/react/tsconfig.json`
- Test: `packages/config/test/eslint.test.ts`

**Interfaces:**

- Produces: `komtruEslint({ tsconfigRootDir, project?, react?: boolean, ignores? })` — unchanged signature; `react: true` now additionally enables `eslint-plugin-react-hooks`' recommended rules and `eslint-config-next`'s `@next/next` rules on `**/*.{ts,tsx,js,jsx}`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/config/test/eslint.test.ts` a second `lint` helper, `lintReact(file)`, identical to `lint` but with `react: true` and the `fixtures/react` directory, and these cases:

```ts
describe('komtruEslint({ react: true })', () => {
  it('reports a hook called conditionally', async () => {
    expect((await lintReact('conditional-hook.tsx')).map((m) => m.ruleId)).toContain(
      'react-hooks/rules-of-hooks',
    );
  });

  it('reports a raw <img> through the Next.js rules', async () => {
    expect((await lintReact('img-element.tsx')).map((m) => m.ruleId)).toContain('@next/next/no-img-element');
  });

  it('reports nothing on a clean component', async () => {
    expect(await lintReact('clean.tsx')).toEqual([]);
  });

  it('leaves both rule sets off without react: true', async () => {
    const config = komtruEslint({ tsconfigRootDir: reactFixtures, project: './tsconfig.json' });
    const names = config.flatMap((entry) => Object.keys(entry.plugins ?? {}));
    expect(names).not.toContain('react-hooks');
    expect(names).not.toContain('@next/next');
  });
});
```

`conditional-hook.tsx` calls `useState` inside an `if`. `img-element.tsx` returns `<img src="/a.png" alt="a" />`. `clean.tsx` returns a `<div>` and calls `useState` at the top level. `fixtures/react/tsconfig.json` extends the existing `fixtures/tsconfig.json` and sets `"jsx": "react-jsx"`, `"include": ["react"]`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @komtru/config test`
Expected: FAIL — the three rule assertions find no messages.

- [ ] **Step 3: Add the rules**

In `packages/config/eslint/index.mjs`, import `eslint-plugin-react-hooks` and `eslint-config-next`'s flat config, and push one additional config object when `react` is true. `eslint-config-next` 15 publishes flat configs under `eslint-config-next/flat/core-web-vitals` (verify the subpath against the installed package before writing the import; if the installed build only publishes the legacy object, register `@next/eslint-plugin-next`'s plugin and its `recommended` + `core-web-vitals` rule maps directly rather than reaching for a compat shim). Scope the object to `files: ['**/*.{ts,tsx,js,jsx}']`. React 19 needs no `react-in-jsx-scope`, so do not add `eslint-plugin-react` itself — the ticket asks for the Next.js 15 and `react-hooks` rules only.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @komtru/config test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config
git commit -m "feat(config): add the next.js 15 and react-hooks rules to komtruEslint"
```

---

### Task 2: The `@komtru/app-kit` package and its config reader

**Files:**

- Create: `packages/app-kit/package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `packages/app-kit/src/index.ts`, `packages/app-kit/src/config.ts`
- Test: `packages/app-kit/test/config.test.ts`

**Interfaces:**

- Produces:

```ts
export interface AppSpec {
  readonly appName: string;
  readonly scope: SessionScope;
  readonly signInPath?: string; // default '/sign-in'
  readonly homePath?: string; // default '/'
  /** Env var naming the app a session of another scope belongs to, e.g. NEXT_PUBLIC_KOMTRU_LOGISTICS_URL. */
  readonly elsewhereUrlEnv?: string;
}
export interface AppConfig {
  readonly appName: string;
  readonly scope: SessionScope;
  readonly appUrl: string;
  readonly apiUrl: string;
  readonly socketUrl: string | undefined;
  readonly sentryDsn: string | undefined;
  readonly signInPath: string;
  readonly homePath: string;
  readonly elsewhereUrl: string | undefined;
}
export function readAppConfig(spec: AppSpec, env: Record<string, string | undefined>): AppConfig;
```

`package.json`: `name` `@komtru/app-kit`, `private`, `type: module`, scripts `build`/`lint`/`typecheck`/`test` copied from `packages/api-client/package.json`, and `exports` for `.`, `./next`, `./react`, `./sentry`, `./ui` (all `dist`-pointing, `types` first) plus `"./styles.css": "./src/styles.css"` and `"./templates/*": "./templates/*"`. `dependencies`: `@komtru/api-client`, `@komtru/shared-types`, `@komtru/ui-kit` (all `workspace:*`), `zod` `4.6.5`. `peerDependencies`: `next` `15.5.27`, `react` `19.3.0`, `react-dom` `19.3.0`, `@tanstack/react-query` `5.104.1`, `@sentry/nextjs` `11.4.0`; `@sentry/nextjs` and `@tanstack/react-query` optional via `peerDependenciesMeta`. `devDependencies` mirror `api-client`'s plus `next`, `@sentry/nextjs`, `jsdom`, `@testing-library/react`, `axe-core` `4.14.0`, `tailwindcss` `4.3.3`.

`tsconfig.json`/`tsconfig.build.json`: copy `packages/ui-kit`'s pair (they already carry `jsx: react-jsx`, `moduleResolution: bundler` and the DOM lib); `include` is `["src", "test", "*.config.ts", "*.config.mjs"]` for the first and `["src"]` for the second, excluding `**/*.test.ts(x)`.
`vitest.config.ts`: `defineKomtruVitest({ test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] } })`.
`eslint.config.mjs`: `komtruEslint({ tsconfigRootDir: import.meta.dirname, react: true })`.

- [ ] **Step 1: Write the failing test**

```ts
const env = {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
  NEXT_PUBLIC_KOMTRU_SOCKET_URL: 'https://api.komtru.com',
};
const spec = { appName: 'web-app-ui', scope: 'CONSUMER' } as const;

it('reads the public environment and applies the path defaults', () => {
  expect(readAppConfig(spec, env)).toEqual({
    appName: 'web-app-ui',
    scope: 'CONSUMER',
    appUrl: 'https://app.komtru.com',
    apiUrl: 'https://api.komtru.com/v1',
    socketUrl: 'https://api.komtru.com',
    sentryDsn: undefined,
    signInPath: '/sign-in',
    homePath: '/',
    elsewhereUrl: undefined,
  });
});

it('names the variable that is missing', () => {
  expect(() => readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_API_URL: undefined })).toThrow(
    /NEXT_PUBLIC_KOMTRU_API_URL/,
  );
});

it('rejects a URL that is not one', () => {
  expect(() => readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_APP_URL: 'app.komtru.com' })).toThrow(
    /NEXT_PUBLIC_KOMTRU_APP_URL/,
  );
});

it('treats an empty optional variable as absent, because that is what .env.example ships', () => {
  expect(readAppConfig(spec, { ...env, NEXT_PUBLIC_SENTRY_DSN: '' }).sentryDsn).toBeUndefined();
});

it('reads the elsewhere URL from the variable the spec names', () => {
  const parkSpec = {
    ...spec,
    scope: 'LOGISTICS',
    elsewhereUrlEnv: 'NEXT_PUBLIC_KOMTRU_LOGISTICS_URL',
  } as const;
  expect(
    readAppConfig(parkSpec, { ...env, NEXT_PUBLIC_KOMTRU_LOGISTICS_URL: 'https://logistics.komtru.com' })
      .elsewhereUrl,
  ).toBe('https://logistics.komtru.com');
});

it('trims a trailing slash off the API base so a path join never doubles it', () => {
  expect(
    readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1/' }).apiUrl,
  ).toBe('https://api.komtru.com/v1');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @komtru/app-kit test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readAppConfig` in `src/config.ts`**

A zod object over the four `NEXT_PUBLIC_*` names, with `z.url()` on the three URLs. Map `''` to `undefined` before parsing (`.env.example` ships `NEXT_PUBLIC_SENTRY_DSN=` empty and an empty string is not a DSN). On failure, throw an `Error` whose message lists each failing variable by name — a misconfigured app must say which line of `.env.local` is wrong, not print a zod tree. `src/index.ts` re-exports `./config.js`.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @komtru/app-kit test`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit pnpm-lock.yaml
git commit -m "feat(app-kit): add the package and its environment reader"
```

---

### Task 3: The sealed session hint and the two cookies

**Files:**

- Create: `packages/app-kit/src/session.ts`
- Test: `packages/app-kit/test/session.test.ts`

**Interfaces:**

- Consumes: `SessionScope` from `@komtru/shared-types`.
- Produces:

```ts
export const REFRESH_COOKIE = 'komtru_rt';
export const SESSION_COOKIE = 'komtru_session';
export const SESSION_SECRET_ENV = 'KOMTRU_SESSION_SECRET';
export const MIN_SECRET_LENGTH = 32;

export interface SessionHint {
  scope: SessionScope;
  expiresAt: number;
} // epoch ms
export interface SessionSealer {
  seal(hint: SessionHint): Promise<string>;
  /** `null` for anything that does not verify: wrong signature, wrong version, garbage, expired. */
  open(token: string | undefined, now?: number): Promise<SessionHint | null>;
}
export function createSessionSealer(secret: string): SessionSealer;
export function requireSessionSecret(env: Record<string, string | undefined>): string;

export interface KomtruCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}
export function sessionCookies(input: {
  refreshToken: string;
  sealed: string;
  maxAgeSeconds: number;
  secure: boolean;
}): KomtruCookie[];
export function clearedCookies(secure: boolean): KomtruCookie[];
export function secureCookieFor(url: URL): boolean;
```

`REFRESH_COOKIE` carries `path: '/api/auth'` — the route handlers are the only thing that may ever read it. `SESSION_COOKIE` carries `path: '/'`, because middleware needs it on every navigation. Neither sets `Domain`: a host-only cookie is exactly the ticket's "scoped to the app's host", and it is what stops `ops.komtru.com`'s cookie reaching `app.komtru.com`.

- [ ] **Step 1: Write the failing tests**

```ts
const sealer = createSessionSealer('a'.repeat(32));
const hint = { scope: 'STAFF' as const, expiresAt: 2_000_000_000_000 };

it('opens what it sealed', async () => {
  expect(await sealer.open(await sealer.seal(hint), 1_000)).toEqual(hint);
});

it('refuses a hint sealed with another secret', async () => {
  const other = createSessionSealer('b'.repeat(32));
  expect(await sealer.open(await other.seal(hint), 1_000)).toBeNull();
});

it('refuses a hint whose scope was edited', async () => {
  const sealed = await createSessionSealer('a'.repeat(32)).seal({
    scope: 'CONSUMER',
    expiresAt: hint.expiresAt,
  });
  const [version, payload, signature] = sealed.split('.');
  const forged = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  forged.s = 'STAFF';
  const tampered = [
    version,
    btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    signature,
  ].join('.');
  expect(await sealer.open(tampered, 1_000)).toBeNull();
});

it.each([undefined, '', 'nonsense', 'v1.only-two', 'v2.aaa.bbb', 'v1..', 'v1.!!!.!!!'])(
  'returns null rather than throwing for %j',
  async (token) => {
    await expect(sealer.open(token, 1_000)).resolves.toBeNull();
  },
);

it('refuses a hint that has expired', async () => {
  expect(await sealer.open(await sealer.seal(hint), hint.expiresAt + 1)).toBeNull();
});

it('refuses a secret too short to be one', () => {
  expect(() => requireSessionSecret({ KOMTRU_SESSION_SECRET: 'short' })).toThrow(/KOMTRU_SESSION_SECRET/);
  expect(() => requireSessionSecret({})).toThrow(/KOMTRU_SESSION_SECRET/);
});

it('writes both cookies httpOnly, SameSite=Lax and host-only', () => {
  const cookies = sessionCookies({ refreshToken: 'r', sealed: 's', maxAgeSeconds: 60, secure: true });
  expect(cookies.map((c) => [c.name, c.path])).toEqual([
    [REFRESH_COOKIE, '/api/auth'],
    [SESSION_COOKIE, '/'],
  ]);
  for (const cookie of cookies) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
    expect(cookie).not.toHaveProperty('domain');
  }
});

it('clears both with a zero max-age at the same paths', () => {
  expect(clearedCookies(true).map((c) => [c.name, c.value, c.maxAge, c.path])).toEqual([
    [REFRESH_COOKIE, '', 0, '/api/auth'],
    [SESSION_COOKIE, '', 0, '/'],
  ]);
});

it.each([
  ['https://app.komtru.com/x', true],
  ['http://localhost:3001/x', false],
  ['http://127.0.0.1:3001/x', false],
  ['http://[::1]:3001/x', false],
  // Plain http on a real host is a misconfiguration: keep Secure so the browser drops the cookie
  // loudly rather than storing a session credential in the clear.
  ['http://app.komtru.com/x', true],
])('decides Secure for %s', (href, expected) => {
  expect(secureCookieFor(new URL(href))).toBe(expected);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/app-kit test session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/session.ts`**

Format `v1.<base64url(payload)>.<base64url(HMAC-SHA-256)>`, payload `{"s":<scope>,"e":<epoch seconds>}`. `crypto.subtle.importKey`/`sign`/`verify` only — the Edge runtime has no `node:crypto`. Use `crypto.subtle.verify` rather than comparing strings, so the comparison is the platform's constant-time one. Every parse step is inside one `try`/`catch` returning `null`; the scope is re-validated with `sessionScopeSchema` before it is returned, because a signature only proves the payload is ours, not that it is current.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/app-kit test session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): seal the session scope hint and pin the two cookies"
```

---

### Task 4: Middleware

**Files:**

- Create: `packages/app-kit/src/next/middleware.ts`, `packages/app-kit/src/next/index.ts`
- Test: `packages/app-kit/test/next/middleware.test.ts`

**Interfaces:**

- Consumes: `AppConfig` (Task 2), `SessionSealer`, `SESSION_COOKIE`, `clearedCookies`, `secureCookieFor` (Task 3).
- Produces:

```ts
export interface KomtruMiddlewareOptions {
  config: AppConfig;
  sealer: SessionSealer;
  /** Paths that need no session. The sign-in path is always one. Prefix match on a path segment. */
  publicPaths?: readonly string[];
  now?: () => number;
}
export function createKomtruMiddleware(
  options: KomtruMiddlewareOptions,
): (request: NextRequest) => Promise<NextResponse>;
/** What a template's `export const config = { matcher: KOMTRU_MATCHER }` uses. */
export const KOMTRU_MATCHER: readonly string[];
```

Order: `/api/auth/*` passes (it is the only way to get a session); `/_next/*`, `/favicon.ico` and anything with a file extension pass (defence in depth behind the matcher); a public path passes; no or unopenable hint redirects to `signInPath?next=<pathname+search>` with both cookies cleared; a hint whose `scope` is not `config.scope` redirects to `elsewhereUrl` when the spec names one and otherwise to `signInPath?error=wrong-scope`, with both cookies cleared; everything else passes.

- [ ] **Step 1: Write the failing tests**

Build a `NextRequest` with `new NextRequest(new URL(path, config.appUrl), { headers: { cookie: … } })`. Table-drive the scope matrix over every (required scope, token scope) pair:

```ts
const APPS = [
  { app: 'web-app-ui', scope: 'CONSUMER' },
  { app: 'operations-app', scope: 'STAFF' },
  { app: 'logistics-ops', scope: 'LOGISTICS' },
  { app: 'park-agent-app', scope: 'LOGISTICS' },
] as const;

describe.each(APPS)('$app middleware', ({ scope: required }) => {
  it.each(SESSION_SCOPES)('%s session', async (held) => {
    const response = await run(required, await sealed(held), '/trades');
    if (held === required) {
      expect(response.headers.get('x-middleware-next')).toBe('1');
    } else {
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/sign-in');
    }
  });
});

it('rejects a consumer token at every app that is not the consumer app', async () => {
  for (const { scope } of APPS.filter((a) => a.scope !== 'CONSUMER')) {
    expect((await run(scope, await sealed('CONSUMER'), '/queue')).status).toBe(307);
  }
});

it('sends a wrong-scope session to the app it belongs to when one is configured', async () => {
  const response = await run('LOGISTICS', await sealed('CONSUMER'), '/parcels', {
    elsewhereUrl: 'https://app.komtru.com',
  });
  expect(response.headers.get('location')).toBe('https://app.komtru.com/');
});

it('clears both cookies on every rejection, so the next navigation is not rejected twice', async () => {
  const response = await run('STAFF', await sealed('CONSUMER'), '/queue');
  const set = response.headers.getSetCookie();
  expect(set.filter((c) => c.startsWith('komtru_rt=') || c.startsWith('komtru_session='))).toHaveLength(2);
  for (const cookie of set) expect(cookie).toMatch(/Max-Age=0/);
});

it('remembers where the visitor was going', async () => {
  const location = new URL(
    (await run('CONSUMER', undefined, '/trades/KMT-1?tab=evidence')).headers.get('location')!,
  );
  expect(location.searchParams.get('next')).toBe('/trades/KMT-1?tab=evidence');
});

it.each(['/sign-in', '/api/auth/refresh', '/_next/static/chunk.js', '/favicon.ico'])(
  'lets %s through with no session',
  async (path) => {
    expect((await run('CONSUMER', undefined, path)).headers.get('x-middleware-next')).toBe('1');
  },
);

it('does not throw on a cookie someone made up', async () => {
  expect((await run('CONSUMER', 'v1.notbase64.notasignature', '/trades')).status).toBe(307);
});

it('redirects an expired hint rather than trusting it', async () => {
  const stale = await sealer.seal({ scope: 'CONSUMER', expiresAt: 1_000 });
  expect((await run('CONSUMER', stale, '/trades', { now: () => 2_000 })).status).toBe(307);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/app-kit test middleware`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createKomtruMiddleware` and `KOMTRU_MATCHER`**

`KOMTRU_MATCHER` is `['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']`. The in-function guards repeat it because a template that overrides the matcher must not lose the rule.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/app-kit test middleware`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): enforce the app's session scope in middleware"
```

---

### Task 5: The `/api/auth/*` route handlers

**Files:**

- Create: `packages/app-kit/src/next/auth-routes.ts`
- Modify: `packages/app-kit/src/next/index.ts`
- Test: `packages/app-kit/test/next/auth-routes.test.ts`

**Interfaces:**

- Consumes: `AppConfig`, `SessionSealer`, the cookie helpers, and `problemFromResponse`/`readResponseMeta` from `@komtru/api-client`.
- Produces:

```ts
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // M1's 30-day sliding window
export interface AuthRouteOptions {
  config: AppConfig;
  sealer: SessionSealer;
  fetch?: typeof globalThis.fetch;
  /** The backend route sign-in posts to. Default `/auth/login`. */
  loginPath?: string;
  refreshMaxAgeSeconds?: number;
}
export interface AuthRouteHandlers {
  login(request: Request): Promise<Response>;
  refresh(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}
export function createAuthRouteHandlers(options: AuthRouteOptions): AuthRouteHandlers;
/** One catch-all route file: `POST = komtruAuthRoute(options)`. */
export function komtruAuthRoute(
  options: AuthRouteOptions,
): (request: Request, context: { params: Promise<{ action: string[] }> }) => Promise<Response>;
```

Every response carries `Cache-Control: no-store`. The browser is returned `{ accessToken, scope, expiresAt, … }` — never `refreshToken`, which is the whole point of the cookie. The default `loginPath` is `/auth/login` because that is the route `apps/backend-api` actually serves; `backendLoginPath(scope)` in `@komtru/api-client` names `/auth/{scope}/login`, which the backend does not have — record it, do not paper over it.

- [ ] **Step 1: Write the failing tests**

```ts
it('sets the refresh token as a cookie and keeps it out of the body', async () => {
  const response = await handlers.login(post({ identifier: 'a@b.c', password: 'x' }));
  expect(response.status).toBe(200);
  expect(await response.clone().json()).not.toHaveProperty('refreshToken');
  expect(await response.json()).toMatchObject({ accessToken: 'at-1', scope: 'CONSUMER' });
  expect(response.headers.getSetCookie().join(';')).toContain('komtru_rt=rt-1');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('passes a backend problem through with its status and code', async () => {
  backend.reply(401, { type: 'about:blank', code: 'INVALID_CREDENTIALS', title: 'Sign in failed' });
  const response = await handlers.login(post({ identifier: 'a@b.c', password: 'x' }));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("revokes the session it just created when the scope is not this app's", async () => {
  backend.reply(200, { ...session, scope: 'CONSUMER' });
  const response = await staffHandlers.login(post({ identifier: 'a@b.c', password: 'x' }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'WRONG_SCOPE' });
  expect(backend.calls.map((c) => c.path)).toEqual(['/auth/login', '/auth/logout']);
  expect(response.headers.getSetCookie()).toEqual([]);
});

it('rotates both cookies on refresh', async () => {
  backend.reply(200, { ...session, accessToken: 'at-2', refreshToken: 'rt-2' });
  const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
  expect(backend.calls[0]?.body).toEqual({ refreshToken: 'rt-1' });
  expect(response.headers.getSetCookie().join(';')).toContain('komtru_rt=rt-2');
});

it('answers 401 with no cookie at all, which is what ends the session client-side', async () => {
  expect((await handlers.refresh(post())).status).toBe(401);
});

it('ends the session when the backend says the credential is gone', async () => {
  backend.reply(401, { code: 'SESSION_REVOKED' });
  const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie().every((c) => /Max-Age=0/.test(c))).toBe(true);
});

it('does not sign anyone out because the backend hiccupped', async () => {
  backend.reply(503, { code: 'SERVICE_UNAVAILABLE' });
  const response = await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
  expect(response.status).toBe(503);
  expect(response.headers.getSetCookie()).toEqual([]);
});

it('rotates once for two tabs that arrive with the same token', async () => {
  backend.replyAfter(20, 200, { ...session, refreshToken: 'rt-2' });
  const [a, b] = await Promise.all([
    handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
    handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' })),
  ]);
  expect(backend.calls).toHaveLength(1);
  expect(await a.json()).toEqual(await b.json());
});

it('mints a fresh rotation once the first has settled', async () => {
  await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
  await handlers.refresh(post(undefined, { cookie: 'komtru_rt=rt-1' }));
  expect(backend.calls).toHaveLength(2);
});

it('signs out locally even when the backend cannot be reached', async () => {
  backend.fail(new TypeError('fetch failed'));
  const response = await handlers.logout(post({ allDevices: false }, { cookie: 'komtru_rt=rt-1' }));
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie().every((c) => /Max-Age=0/.test(c))).toBe(true);
});

it('serves the three actions from one catch-all and 404s anything else', async () => {
  const route = komtruAuthRoute(options);
  expect((await route(post(), { params: Promise.resolve({ action: ['logout'] }) })).status).toBe(200);
  expect((await route(post(), { params: Promise.resolve({ action: ['steal'] }) })).status).toBe(404);
});
```

`backend` is a local fetch double recording `{ path, body }`; `post` builds a `Request` at `https://app.komtru.com/api/auth/x`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/app-kit test auth-routes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createAuthRouteHandlers` and `komtruAuthRoute`**

The cross-tab mitigation is a module-level `Map<string, Promise<Response>>` keyed by the incoming refresh token, cleared in `finally`, and the shared `Response` is `.clone()`d per caller. It holds one in-flight rotation per process only — two instances behind a load balancer still race, which is the honest limit and goes in the ticket note. Responses are built with `Response.json()` and the cookies appended with `headers.append('Set-Cookie', …)` so the handlers stay usable outside `NextResponse`.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/app-kit test auth-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): own the refresh cookie in the app's auth route handlers"
```

---

### Task 6: Sentry

**Files:**

- Create: `packages/app-kit/src/sentry.ts`
- Test: `packages/app-kit/test/sentry.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ErrorTracker {
  enabled: boolean;
  captureException(error: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
}
export function sentryOptions(
  config: AppConfig,
  runtime: 'server' | 'edge' | 'browser',
): Record<string, unknown>;
export function initSentry(config: AppConfig, runtime: 'server' | 'edge' | 'browser'): ErrorTracker;
```

Mirrors `apps/backend-api/src/platform/sentry.ts` exactly, including its `dataCollection` lockdown — this is an escrow platform and a stack trace is all Sentry gets. `tags: { app: config.appName, runtime }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is a no-op without a DSN, which is local development', () => {
  const tracker = initSentry({ ...config, sentryDsn: undefined }, 'server');
  expect(tracker.enabled).toBe(false);
  expect(() => tracker.captureException(new Error('x'))).not.toThrow();
  expect(Sentry.init).not.toHaveBeenCalled();
});

it('collects no user, cookie, header, body or query data', () => {
  expect(sentryOptions({ ...config, sentryDsn: 'https://k@o.ingest.sentry.io/1' }, 'edge')).toMatchObject({
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    initialScope: { tags: { app: 'web-app-ui', runtime: 'edge' } },
  });
});

it('tags which app and which runtime reported', () => {
  /* server and browser */
});
```

- [ ] **Step 2–4: fail, implement, pass**

Run: `pnpm --filter @komtru/app-kit test sentry`

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): report app errors to sentry with no personal data attached"
```

---

### Task 7: The global stylesheet, and the body line-height T-013 and T-014 measured

**Files:**

- Create: `packages/app-kit/src/styles.css`
- Test: `packages/app-kit/test/styles.test.ts`

**Interfaces:**

- Produces: `@komtru/app-kit/styles.css`, which an app's `app/globals.css` imports as its only entry into the design system.

**What the drift actually is, measured rather than inherited:** the reference HTML declares **no** global line-height — `body{margin:0; font-family:…; background:…; color:…; -webkit-font-smoothing:antialiased;}` at l.39 and its four restatements, and no `*` or `html` rule carries one either. Tailwind v4's preflight does: `html, :host { line-height: 1.5 }`. So every element that does not state its own line-height is `normal` (font-metric derived, ≈1.21 for Inter) in the reference and `1.5` in anything built on the preset — which is the 1–2px per paragraph T-013's visual check saw and the ~8px by the fourth evidence row T-014 saw. The reference's own long-form prose rules all state `1.5` or `1.6` explicitly, so restoring `normal` globally does not leave body copy set tight; it leaves it set the way all 210 reference screens are drawn.

- [ ] **Step 1: Write the failing tests**

```ts
it('still matches the reference, which declares no global line-height', () => {
  const html = readFileSync(REFERENCE, 'utf8');
  for (const rule of globalRules(html, ['body', 'html', '*'])) {
    expect(Object.keys(rule.declarations)).not.toContain('line-height');
  }
});

it("undoes preflight, so an element that states no line-height is the reference's normal", async () => {
  expect(await resolved('html', 'line-height')).toBe('normal');
});

it('keeps the element defaults the reference states on body', async () => {
  expect(await resolved('body', 'margin')).toBe('0');
  expect(await resolved('body', 'font-family')).toBe('var(--font-body)');
  expect(await resolved('body', 'background')).toBe('var(--cloud-gray)');
  expect(await resolved('body', 'color')).toBe('var(--midnight-text)');
  expect(await resolved('body', '-webkit-font-smoothing')).toBe('antialiased');
});

it('carries the two keyframes the primitives name, or Skeleton and NodeLoader sit still', () => {
  for (const name of ['shimmer', 'nodePulse']) expect(sheet).toMatch(new RegExp(`@keyframes\\s+${name}`));
});

it("carries the global focus ring a screen's own focusable elements depend on", async () => {
  expect(await resolved(':focus-visible', 'outline')).toBe('2.5px solid var(--trust-indigo)');
});

it("declares every @source Tailwind needs to see the packages' class names", () => {
  for (const dir of sources(sheet)) expect(existsSync(dir)).toBe(true);
  expect(sources(sheet).map((d) => basename(dirname(d)))).toEqual(
    expect.arrayContaining(['app-kit', 'ui-kit']),
  );
});

it('is byte-identical to what .storybook/preview.css declares for the same selectors', () => {
  // The stories are the only place these rules are looked at today; a story that lies about
  // the app is worse than no story.
  for (const selector of ['body', 'h1, h2, h3, h4', 'p', 'img, svg', ':focus-visible']) {
    expect(declarationsOf(sheet, selector)).toEqual(declarationsOf(previewCss, selector));
  }
});
```

`resolved()` compiles `src/styles.css` with `compile()` from `tailwindcss` (the same bootstrap `packages/ui-kit/test/reference-css.ts` uses: read the file, pass `base` and a `loadStylesheet` that resolves `@import`), then merges every matching rule in emission order. `globalRules` reuses `parseCssDeclarations` from `@komtru/ui-kit/extract-tokens`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/app-kit test styles`
Expected: FAIL — file not found.

- [ ] **Step 3: Write `src/styles.css`**

`@import '@komtru/config/tailwind/preset.css';` then `@source '../dist';` and `@source '../../ui-kit/dist';` (Tailwind v4 does not scan `node_modules`, and both packages' class names live there from the app's point of view; the relative paths resolve inside this workspace, which is the only place this package is consumed), then `html { line-height: normal; }` with the measurement above as its comment, then the two `@keyframes`, the `body`/`h1–h4`/`p`/`img,svg` defaults and the `:focus-visible` rule, copied from `packages/ui-kit/.storybook/preview.css`.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/app-kit test styles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): ship the app stylesheet and restore the reference's line-height"
```

---

### Task 8: `md` as the shell-swap rule

**Files:**

- Create: `packages/app-kit/src/layout.ts`
- Modify: `packages/app-kit/src/index.ts`
- Test: `packages/app-kit/test/layout.test.ts`

**Interfaces:**

- Consumes: `BREAKPOINTS` from `@komtru/ui-kit`.
- Produces:

```ts
export const SHELL_BREAKPOINT: 768;
export const SHELL_VARIANT: 'md';
export const SHELL_MEDIA_QUERY: '(width >= 48rem)';
export type ShellKind = 'mobile' | 'desktop';
export function shellForWidth(width: number): ShellKind;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('is md, the breakpoint ui-kit exports and nothing enforced', () => {
  expect(SHELL_BREAKPOINT).toBe(768);
  expect(SHELL_BREAKPOINT).toBe(BREAKPOINTS.md);
});

it('swaps at the breakpoint, not after it', () => {
  expect(shellForWidth(767)).toBe('mobile');
  expect(shellForWidth(768)).toBe('desktop');
  expect(shellForWidth(1440)).toBe('desktop');
});

it('holds the rem and the px together, which is the bridge T-013 left open', () => {
  expect(48 * 16).toBe(SHELL_BREAKPOINT);
});

it('is the same width Tailwind compiles the md: variant to', async () => {
  // A preset that redefined md would silently move the swap; this is what stops it.
  expect(await mediaConditionOf(`${SHELL_VARIANT}:hidden`)).toBe(SHELL_MEDIA_QUERY);
});
```

`mediaConditionOf` compiles the one class through the preset and returns its enclosing `@media` condition.

- [ ] **Step 2–4: fail, implement, pass**

Run: `pnpm --filter @komtru/app-kit test layout`

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): pin md as the width an app swaps shells at"
```

---

### Task 9: Query and realtime providers

**Files:**

- Create: `packages/app-kit/src/react/providers.tsx`, `packages/app-kit/src/react/index.ts`
- Test: `packages/app-kit/test/react/providers.test.tsx` (`@vitest-environment jsdom` docblock)

**Interfaces:**

- Consumes: `createApiClient`, `createTokenStore`, `createRouteHandlerRefresh`, `retryProblemAware`, `RealtimeProvider`, `AuthSession` from `@komtru/api-client` and `@komtru/api-client/react`.
- Produces:

```ts
export function createKomtruQueryClient(): QueryClient;
export interface KomtruProvidersProps {
  config: Pick<AppConfig, 'apiUrl' | 'socketUrl'>;
  /** Minted by the Server Component layout from the refresh cookie; `null` before sign-in. */
  session: AuthSession | null;
  /** Short-lived socket token (socket guide §6). Omit and no socket is opened. */
  socketToken?: string;
  resyncQueryKeys?: readonly (readonly unknown[])[];
  onSessionEnded?: () => void;
  queryClient?: QueryClient;
  children: ReactNode;
}
export function KomtruProviders(props: KomtruProvidersProps): JSX.Element;
export function useApiClient(): ApiClient;
export function useSession(): AuthSession | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('hands every consumer one client, built once per mount', () => {
  /* two useApiClient() reads are the same object across a re-render */
});
it('seeds the token store from the server-rendered session before the first query runs', () => {
  /* a child that calls useApiClient().tokens!.read() on first render sees the access token */
});
it("refreshes through the app's own route handler, not the backend", async () => {
  /* a 401 then a 200 from a stubbed fetch: the refresh goes to /api/auth/refresh with credentials included */
});
it('calls onSessionEnded when the refresh says the session is over', async () => {});
it('opens no socket without a token', () => {
  /* connect factory never called */
});
it('opens one when there is a token and invalidates the named keys on reconnect', async () => {});
it('retries a read and not a non-idempotent failure', () => {
  /* createKomtruQueryClient().getDefaultOptions().queries.retry behaves as retryProblemAware({ idempotent: true }) */
});
it('throws a named error when useApiClient is called outside the provider', () => {});
```

- [ ] **Step 2–4: fail, implement, pass**

The client is built in a `useState` initialiser and the session seeded there too, so it exists before the first child renders. `RealtimeProvider` is mounted only when `socketToken` is a non-empty string; `connect` is forwarded so a test can inject a fake, the way `api-client`'s own suite does.

Run: `pnpm --filter @komtru/app-kit test providers`

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): mount one api client, query client and socket per app"
```

---

### Task 10: The error and not-found screens

**Files:**

- Create: `packages/app-kit/src/ui/ErrorScreen.tsx`, `packages/app-kit/src/ui/NotFoundScreen.tsx`, `packages/app-kit/src/ui/index.ts`
- Test: `packages/app-kit/test/ui/screens.test.tsx` (`@vitest-environment jsdom`)

**Interfaces:**

- Consumes: `EmptyState`, `Button` from `@komtru/ui-kit`.
- Produces:

```ts
export interface ErrorScreenProps {
  /** The Sentry event id or the X-Request-Id. Shown in mono, the way a Trade code is. */
  reference?: string;
  onRetry?: () => void;
  homeHref: string;
  homeLabel: string;
}
export function ErrorScreen(props: ErrorScreenProps): JSX.Element;
export interface NotFoundScreenProps {
  homeHref: string;
  homeLabel: string;
}
export function NotFoundScreen(props: NotFoundScreenProps): JSX.Element;
```

**Design.** The reference's own failure screens (WF1 l.6263, the PIN guard at l.6518) set the voice: a risk-toned icon, a sentence-case headline that says what happened in the user's words, a body that says what is still safe and what to do next, then one or two stacked actions. No apology, no "oops", no error code as the headline. Both screens are `EmptyState` — `tone="error"` for the failure, `tone="empty"` for the absence, because a missing page is not a fault — centred in a `min-h-dvh` `bg-surface-secondary` page with the panel capped at 360px. The one thing beyond the system: **a failure gets a reference code, in `font-mono`, the way a Trade does** (`KMT-90142` at l.9133 is the pattern). That is the single memorable element; everything else stays quiet.

Copy, fixed:

- Error — title `This page didn't load`; body `Nothing you were doing was changed. Try again, and if it keeps happening give support the reference below.`; actions `Try again` then `{homeLabel}`.
- Not found — title `That page isn't here`; body `The link may be out of date, or whatever was here has moved on.`; action `{homeLabel}` only. (One way out is enough; the second button was the accessory to remove.)

**Neither screen renders a `<main>`.** `error.tsx` renders inside the app's layout, which already has the shell's `<main>`, and two `main` landmarks is an `axe` violation on every error. The `global-error.tsx` template — which replaces the whole document — supplies the landmark instead.

- [ ] **Step 1: Write the failing tests**

```ts
it('says what happened and what is safe, in the reference\'s voice', () => {
  render(<ErrorScreen homeHref="/" homeLabel="Go to Trades" />);
  expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent("This page didn't load");
  expect(screen.getByText(/Nothing you were doing was changed/)).toBeTruthy();
});

it('shows the reference in mono when there is one and nothing when there is not', () => {});
it('offers Try again only when there is something to retry', () => {});
it('gives a missing page one way out and no retry', () => {});
it('renders no main landmark, because the layout already has one', () => {
  const { container } = render(<ErrorScreen homeHref="/" homeLabel="Go to Trades" />);
  expect(container.querySelector('main')).toBeNull();
});
it.each([['ErrorScreen'], ['NotFoundScreen']])('%s passes axe', async () => { /* the ui-kit axe helper, color-contrast off */ });
it('uses no raw colour: every class is a token utility', () => { /* no #rrggbb in the rendered class attributes */ });
```

- [ ] **Step 2–4: fail, implement, pass**

Run: `pnpm --filter @komtru/app-kit test screens`

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit
git commit -m "feat(app-kit): draw the error and not-found screens in the design language"
```

---

### Task 11: Templates, the four apps, the env files and CI

**Files:**

- Create: `packages/app-kit/templates/middleware.ts`, `templates/instrumentation.ts`, `templates/instrumentation-client.ts`, `templates/app/api/auth/[action]/route.ts`, `templates/app/error.tsx`, `templates/app/global-error.tsx`, `templates/app/not-found.tsx`, `templates/app/globals.css`
- Create: `apps/{web-app-ui,operations-app,logistics-ops,park-agent-app}/src/app-config.ts` and `test/app-config.test.ts`
- Modify: the four apps' `package.json` (add `@komtru/app-kit` `workspace:*`), `src/index.ts` (re-export the config), `.env.example` (add `KOMTRU_SESSION_SECRET`)
- Modify: `.github/workflows/{web-app-ui,operations-app,logistics-ops,park-agent-app}.yml`
- Test: `packages/app-kit/test/templates.test.ts`

**Interfaces:**

- Produces: `export const appSpec: AppSpec` from each app, and `@komtru/app-kit/templates/*` as files a scaffold ticket copies verbatim.

The templates are not compiled by this package (they import `next`, which the apps own): `tsconfig.json` excludes `templates`, `eslint.config.mjs` ignores it, and `test/templates.test.ts` is what keeps them honest instead.

The four apps stay plain TypeScript libraries. Turning them into Next apps is T-110, T-140, T-160 and T-170 by name, and doing it here would collide with all four. What lands in them is the one module a scaffold needs on day one — its `AppSpec` — plus the environment variable the foundation introduced.

- [ ] **Step 1: Write the failing tests**

`packages/app-kit/test/templates.test.ts`:

```ts
it('imports only names this package exports from subpaths this package declares', () => {
  for (const file of templateFiles()) {
    for (const { specifier, names } of komtruImports(file)) {
      expect(Object.keys(manifest.exports)).toContain(specifier.replace('@komtru/app-kit', '.'));
      for (const name of names) expect(exportedNamesOf(specifier)).toContain(name);
    }
  }
});

it('wires a matcher on the middleware template', () => {
  expect(read('middleware.ts')).toContain('KOMTRU_MATCHER');
});

it('reads the session secret from the server, never from a NEXT_PUBLIC_ variable', () => {
  for (const file of templateFiles()) expect(read(file)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
});
```

`apps/<app>/test/app-config.test.ts`, one per app:

```ts
it('names the scope this app requires', () => {
  expect(appSpec.scope).toBe('CONSUMER'); // STAFF / LOGISTICS / LOGISTICS
});

it("builds a config from this app's own .env.example", () => {
  const env = parseEnvExample(); // reads ../.env.example
  expect(readAppConfig(appSpec, env).appUrl).toBe('http://localhost:3001');
});

it('.env.example declares the session secret the middleware needs', () => {
  expect(Object.keys(parseEnvExample())).toContain('KOMTRU_SESSION_SECRET');
});
```

Then add to `scripts/test/ci-workflows.test.ts` nothing at all — its existing "path-filtered to the app, its workspace dependencies and the shared root files" test already derives the expected list from the dependency graph, so it will fail until the four workflows are updated. Run it and read the diff.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/app-kit test templates && pnpm test:repo`
Expected: FAIL — templates missing, and `ci-workflows.test.ts` reports four workflows missing `packages/app-kit/**`, `packages/ui-kit/**`, `packages/api-client/**`, `packages/shared-types/**`.

- [ ] **Step 3: Write the templates, the four app configs and the workflow filters**

`templates/middleware.ts` is the whole wiring in one screen: `readAppConfig(appSpec, process.env)`, `createSessionSealer(requireSessionSecret(process.env))`, `export default createKomtruMiddleware({ config, sealer })`, `export const config = { matcher: KOMTRU_MATCHER }`. `templates/app/globals.css` is `@import '@komtru/app-kit/styles.css';` plus the app's own `@source './**/*.tsx';`. `templates/app/error.tsx` is a `'use client'` component rendering `ErrorScreen` with `reference={error.digest}` and `onRetry={reset}`.

Add `packages/app-kit/**` and its transitive package directories to each app workflow's two `paths:` lists, in the order the test's `Set` comparison does not care about but a reader does: app, then packages alphabetically, then the root files.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/app-kit test && pnpm test:repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-kit apps .github pnpm-lock.yaml
git commit -m "feat(app-kit): template the per-app wiring and give each app its spec"
```

---

### Task 12: The layout decision, the README and the ticket note

**Files:**

- Create: `packages/app-kit/README.md`
- Modify: `docs/tickets/01-shared-packages.md` (§ T-017)

- [ ] **Step 1: Write `packages/app-kit/README.md`**

What the package is, the five pieces, the exact wiring an app copies, and — in its own section — **why this is `packages/app-kit` and not `packages/ui-kit/src/next/**`**, with the cost of being wrong in each direction stated rather than implied.

- [ ] **Step 2: Write the T-017 note**

`- **Status:** Done (2026-10-06). Plan: …`, then a note at the depth of the T-013 note in the same file: the layout decision and its reasoning; the line-height finding (the reference declares none, Tailwind's preflight does, and which way the drift ran); the `md` rule and why no component swaps shells at runtime; the middleware's honest security boundary; the cross-tab refresh mitigation and its one-process limit; `backendLoginPath`'s mismatch with the route the backend serves; and a `- **Deferred:**` list.

- [ ] **Step 3: Commit**

```bash
git add packages/app-kit/README.md docs
git commit -m "docs(app-kit): record the package-boundary decision and close T-017"
```

---

## Verification before completion

```bash
rm -rf packages/ui-kit/storybook-static
pnpm -w exec turbo run lint typecheck test build --force
pnpm test:repo
pnpm -w exec prettier --check .
```

All four must pass with output quoted, before the ticket is marked done.
