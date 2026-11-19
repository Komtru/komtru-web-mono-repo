import { komtruEslint } from '@komtru/config/eslint';

export default [
  ...komtruEslint({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    ignores: ['public/**', '.next/**', 'next-env.d.ts'],
  }),
  {
    /*
     * The reference's illustrations, carried across as drawn.
     *
     * `no-raw-hex` exists so an interface cannot grow a colour the design system does not have, and
     * it is right about every file but these. These are pictures: skin and hair tones, a titanium
     * phone rail, the brown of a cardboard box. None of them is a token, none of them should become
     * one, and recolouring them to the nearest token would redraw the artwork.
     *
     * The palette the illustrations share with the interface — the indigo, the emerald, the
     * midnight — is identical to the tokens by value, because the same designer drew both.
     */
    files: ['src/art/**/*.tsx'],
    rules: { 'komtru-design/no-raw-hex': 'off' },
  },
];
