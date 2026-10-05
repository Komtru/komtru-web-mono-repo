import { komtruEslint } from './eslint/index.mjs';

export default komtruEslint({ tsconfigRootDir: import.meta.dirname, ignores: ['test/fixtures/**'] });
