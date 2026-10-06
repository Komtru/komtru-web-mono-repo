import { komtruEslint } from '@komtru/config/eslint';

// `react: true` turns on the Next.js 15 and react-hooks rule sets. `public/sw.js` is a service
// worker: plain JS, no TypeScript project behind it, and its own `self`-typed global scope.
export default komtruEslint({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  ignores: ['public/**', '.next/**', 'next-env.d.ts'],
});
