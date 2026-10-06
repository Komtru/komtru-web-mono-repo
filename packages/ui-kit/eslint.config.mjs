import { komtruEslint } from '@komtru/config/eslint';

// `storybook-static` is `build-storybook`'s output: git ignores it, and so must the linter —
// otherwise running the Storybook build before `pnpm lint` fails the lint on bundled vendor code.
export default komtruEslint({
  tsconfigRootDir: import.meta.dirname,
  ignores: ['**/storybook-static/**'],
});
