import { komtruEslint } from '@komtru/config/eslint';
import moduleBoundaries from './eslint-rules/module-boundaries.mjs';
import pgbouncerSafe from './eslint-rules/pgbouncer-safe.mjs';
import providerClients from './eslint-rules/provider-clients.mjs';

export default [
  ...komtruEslint({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.ts'],
    plugins: {
      komtru: {
        rules: {
          'module-boundaries': moduleBoundaries,
          'pgbouncer-safe': pgbouncerSafe,
          'provider-clients': providerClients,
        },
      },
    },
    rules: {
      'komtru/module-boundaries': 'error',
      'komtru/pgbouncer-safe': 'error',
      'komtru/provider-clients': 'error',
    },
  },
];
