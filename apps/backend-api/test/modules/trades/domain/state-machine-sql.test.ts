// The database's copy of the machine is generated from the map, never typed twice. If this fails,
// migration 0018 was hand-edited or the map changed without regenerating it.
import { readFile } from 'node:fs/promises';
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

  it('matches the shipped migration, so the map and the database cannot drift', async () => {
    const migration = await readFile(
      new URL('../../../../drizzle/0018_trade_state_machine.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(transitionFunctionSql());
  });
});
