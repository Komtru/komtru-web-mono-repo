// The database's copy of the machine is generated from the map, never typed twice. If this fails,
// the state-machine migration was hand-edited or the map changed without regenerating it.
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { transitionTriples } from '../../../../src/modules/trades/domain/stateMachine.js';
import { transitionFunctionSql } from '../../../../src/modules/trades/domain/stateMachineSql.js';

describe('transitionFunctionSql', () => {
  it('emits one row per edge in the map', () => {
    const sql = transitionFunctionSql();
    for (const [action, from, to] of transitionTriples()) {
      expect(sql).toContain(`('${action}', '${from}', '${to}')`);
    }
    expect(sql.split('\n').filter((line) => line.trim().startsWith("('"))).toHaveLength(
      transitionTriples().length,
    );
  });

  // Found by name, not by number: migrations are renumbered when branches are merged, and a test
  // pinned to 0018 would start passing vacuously the moment that happened.
  it('matches the shipped migration, so the map and the database cannot drift', async () => {
    const directory = new URL('../../../../drizzle/', import.meta.url);
    const matches = (await readdir(directory)).filter((file) =>
      /^\d{4}_trade_state_machine\.sql$/.test(file),
    );
    expect(matches).toHaveLength(1);
    const migration = await readFile(new URL(matches[0]!, directory), 'utf8');
    expect(migration).toContain(transitionFunctionSql());
  });
});
