import type { Linter } from 'eslint';

export interface KomtruEslintOptions {
  /** Directory the tsconfig used for type-aware linting is resolved from. */
  tsconfigRootDir: string;
  /** Explicit tsconfig path(s); when omitted the TypeScript project service finds them. */
  project?: string | string[];
  /** Adds browser globals for React apps. Next.js rules are layered on by each app. */
  react?: boolean;
  ignores?: string[];
}

export declare function komtruEslint(options: KomtruEslintOptions): Linter.Config[];
export default komtruEslint;
