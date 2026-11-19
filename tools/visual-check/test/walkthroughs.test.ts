// The walks a ticket can name are checked against the v2 screen index. The package's default reference is v2,
// but this package's vitest run pins v1, so the index is read by path rather than through `loadScreens`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PERSONA_IDS, SCENARIO_IDS } from '../src/standin/personas.ts';
import { parseScreenIndex, REFERENCE_DIR } from '../src/screen-index.ts';
import { WALKTHROUGHS, walkFor } from '../src/walkthroughs.ts';

const v2Rows = parseScreenIndex(readFileSync(new URL('SCREEN_INDEX.md', REFERENCE_DIR), 'utf8'));

describe('the walkthrough registry', () => {
  it.each(Object.values(WALKTHROUGHS))(
    '$screen names a screen in the v2 index, a persona and a scenario',
    (walk) => {
      expect(v2Rows.some((row) => row.id === walk.screen)).toBe(true);
      expect(PERSONA_IDS).toContain(walk.persona);
      expect(SCENARIO_IDS).toContain(walk.scenario);
      expect(walk.path.startsWith('/')).toBe(true);
    },
  );

  it('keys every walk by the screen it reaches', () => {
    for (const [key, walk] of Object.entries(WALKTHROUGHS)) expect(walk.screen).toBe(key);
  });

  it('says which walks exist when asked for one that does not', () => {
    expect(() => walkFor('NOPE-1')).toThrow(/No walkthrough for NOPE-1\. Walks exist for: AC1/);
  });
});
