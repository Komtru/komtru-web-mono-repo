/* eslint-disable komtru-design/no-raw-hex -- the rule's own fixtures are raw colours by definition. */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import noRawHex from '../../eslint/no-raw-hex.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', parser: tseslint.parser },
});

const rawHex = (code: string, ...hexes: string[]) => ({
  code,
  errors: hexes.map((hex) => ({ messageId: 'rawHex', data: { hex } })),
});

tester.run('no-raw-hex', noRawHex, {
  valid: [
    "const colour = 'var(--trust-indigo)';",
    "const cls = 'bg-trust-indigo';",
    "const href = 'https://komtru.com/docs#abc123';",
    "const sha = 'deadbeef';",
    "const anchor = '#pricing';",
    "const hub = '#hub-004';",
    "const tooLong = '#0123456789';",
    "const fiveDigits = '#abcde';",
    "const notHex = '#ghijkl';",
    'const sized = `h-[32px]`;',
    { code: "const white = '#FFFFFF';", options: [{ allow: ['#ffffff'] }] },
  ],
  invalid: [
    rawHex("const colour = '#4552D6';", '#4552D6'),
    rawHex("const colour = '#fff';", '#fff'),
    rawHex("const border = '1px solid #E5E9F0';", '#E5E9F0'),
    rawHex('const cls = `bg-[#4552D6]`;', '#4552D6'),
    rawHex("const cls = 'text-[#0D1420] bg-[#F5F7FA]';", '#0D1420', '#F5F7FA'),
    rawHex("const translucent = '#0D142080';", '#0D142080'),
    rawHex("const shortAlpha = '#fff8';", '#fff8'),
    rawHex('const style = `color: ${tone}; background: #F5F7FA`;', '#F5F7FA'),
    { code: "const white = '#FFFFFF';", options: [{ allow: ['#0D1420'] }], errors: 1 },
  ],
});
