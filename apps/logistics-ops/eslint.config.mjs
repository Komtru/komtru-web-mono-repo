import { komtruEslint } from '@komtru/config/eslint';

// `react: true` turns on the Next.js 15 and react-hooks rule sets.
export default komtruEslint({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  ignores: ['.next/**', 'next-env.d.ts'],
});
