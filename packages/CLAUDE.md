# packages

| Package                | What it owns                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@komtru/config`       | TypeScript, ESLint, Prettier, Vitest and Tailwind presets, including `tailwind/preset.css` — the canonical design tokens |
| `@komtru/shared-types` | the zod schemas and types shared by backend and frontends; the source of truth for every DTO                             |
| `@komtru/ui-kit`       | design tokens, the brand mark, primitives and the TrustOps patterns                                                      |
| `@komtru/api-client`   | the typed API client                                                                                                     |
| `@komtru/app-kit`      | the Next.js foundation every frontend composes                                                                           |

## Build the package before you trust a consumer

Apps and tests consume these from their built `dist`, not from `src`. Edit a package's source
and a consumer silently runs against the stale build — the symptom is a field you just added
reading as `undefined`, or `tsc` insisting a union member does not exist.

```bash
pnpm --filter @komtru/<pkg> build     # after touching one package
pnpm --filter "./packages/**" build   # before verifying a merge
```

Stale `dist` has twice produced a wave of false type errors on `main`, after T-051 and T-191.

## Rules

- A type shared by the backend and any frontend belongs in `shared-types`, defined once as a zod
  schema with the TypeScript type derived from it. Don't restate it on either side.
- A primitive used by more than one app belongs in `ui-kit`, built once. Five copies of a button
  is the failure mode this package exists to prevent.
- Tokens are defined in `config/tailwind/preset.css` only. `ui-kit` and the apps consume them;
  neither redeclares one.
