// Shared ESLint flat config for every Komtru workspace.
// Type-aware rules are on everywhere: they are what catch floating promises and unsafe `any`
// flowing through money and auth code, which is exactly where a silent bug costs most.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { createRequire } from 'node:module';
import tseslint from 'typescript-eslint';
import noRawHex from './no-raw-hex.mjs';

/**
 * `require`, not `import`: `@next/eslint-plugin-next` is CommonJS whose `module.exports` carries
 * both `flatConfig` and a `default` property, and the two ESM loaders this repo runs under disagree
 * about which one a default import resolves to — Node hands back the whole object, Vite hands back
 * `.default`, and the lint config then silently loses `flatConfig` under `vitest` only. `require`
 * returns `module.exports` under both.
 */
const require = createRequire(import.meta.url);
const nextPlugin = require('@next/eslint-plugin-next');
const reactHooks = require('eslint-plugin-react-hooks');

/**
 * The Next.js 15 and React rules, on only where `react: true` (T-017). `@next/eslint-plugin-next`
 * rather than `eslint-config-next`, which exists to deliver it: at 15.5.27 that package publishes
 * only `.eslintrc`-shaped objects and no `exports` field, so reaching it from a flat config needs
 * `FlatCompat` — and it would bring `eslint-plugin-react`, `jsx-a11y`, `import` and `import-x`
 * along with it, four plugins no Komtru workspace asked for. The plugin's own `flatConfig` entries
 * are the same rule sets without the detour.
 *
 * `recommended-latest` is react-hooks 7's full set, including the compiler-aware rules
 * (`set-state-in-effect`, `purity`, `immutability`). On React 19 those catch in review what would
 * otherwise be a rerender bug found on a screen, which is the whole reason this repo lints with
 * type information everywhere else.
 */
const reactConfigs = () => [
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.flatConfig.recommended.rules,
      ...nextPlugin.flatConfig.coreWebVitals.rules,
      // A Pages Router rule. Every Komtru app is App Router, and the rule's own implementation
      // scans for a `pages/` directory and prints a warning to stdout when it cannot find one —
      // on a shared package with no `pages/` at all, that is noise on every lint run.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  { files: ['**/*.{ts,tsx,js,jsx,mjs}'], ...reactHooks.configs.flat['recommended-latest'] },
];

/**
 * @param {{ tsconfigRootDir: string, project?: string | string[], react?: boolean, ignores?: string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function komtruEslint({ tsconfigRootDir, project, react = false, ignores = [] }) {
  return tseslint.config(
    { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/.turbo/**', ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      // Namespaced away from `komtru/*`: apps/backend-api already defines a `komtru` plugin of its
      // own, and ESLint refuses to see one plugin name defined twice.
      plugins: { 'komtru-design': { rules: { 'no-raw-hex': noRawHex } } },
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.node, ...(react ? globals.browser : {}) },
        parserOptions: {
          tsconfigRootDir,
          ...(project ? { project } : { projectService: true }),
        },
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
        'komtru-design/no-raw-hex': 'error',
      },
    },
    ...(react ? reactConfigs() : []),
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}

export default komtruEslint;
