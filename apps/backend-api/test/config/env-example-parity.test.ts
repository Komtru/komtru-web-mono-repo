// `.env.example` is the only documentation an operator has for what this process reads, and nothing
// made it keep up. T-050 added five variables and documented none of them — one of which is a hard
// production boot requirement, so the first production deploy would have failed with a ConfigError
// naming a variable that appears nowhere in the repository's own env documentation.
//
// This closes that, for every module, not just this one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARIABLE_NAMES } from '../../src/config/env.js';

const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

/** `NAME=` at the start of a line, commented-out entries included. */
const documented = new Set(
  example
    .split('\n')
    .map((line) => /^#?\s*([A-Z0-9_]+)=/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined),
);

describe('.env.example', () => {
  it('documents every variable loadConfig reads', () => {
    const missing = CONFIG_VARIABLE_NAMES.filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it('is checking against a real file', () => {
    expect(documented.size).toBeGreaterThan(20);
    expect(CONFIG_VARIABLE_NAMES.length).toBeGreaterThan(20);
  });
});
