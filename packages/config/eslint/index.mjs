// Shared ESLint flat config for every Komtru workspace.
// Type-aware rules are on everywhere: they are what catch floating promises and unsafe `any`
// flowing through money and auth code, which is exactly where a silent bug costs most.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}

export default komtruEslint;
