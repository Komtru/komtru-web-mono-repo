import { komtruEslint } from '@komtru/config/eslint';
import moduleBoundaries from './eslint-rules/module-boundaries.mjs';

export default [
  ...komtruEslint({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.ts'],
    plugins: { komtru: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'komtru/module-boundaries': 'error' },
  },
];
