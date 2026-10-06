import { komtruEslint } from '@komtru/config/eslint';

// `react: true` turns on the Next.js 15 and react-hooks rules this package exists to give the apps.
export default komtruEslint({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  ignores: ['**/templates/**'],
});
