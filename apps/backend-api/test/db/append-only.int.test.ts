// appendOnly() against a real table. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { appendOnly } from '../../src/db/helpers/appendOnly.js';
import { grantRuntimeAccess } from '../../src/db/roles.js';
import { infraEnabled } from '../support/db-urls.js';
import { useTestDatabase } from '../support/db.js';

const sqlState = async (query: Promise<unknown>) => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code;
  }
  return 'no error';
};

describe.runIf(infraEnabled)('appendOnly() on a real table', () => {
  const t = useTestDatabase();

  beforeAll(async () => {
    await t.owner().query('CREATE SCHEMA IF NOT EXISTS audit_probe');
    await t
      .owner()
      .query('CREATE TABLE IF NOT EXISTS audit_probe.events (id serial PRIMARY KEY, note text NOT NULL)');
    const client = await t.owner().connect();
    try {
      await grantRuntimeAccess(client); // as if a migration had created the table first
      for (const statement of appendOnly('audit_probe.events').split('--> statement-breakpoint')) {
        await client.query(statement);
      }
    } finally {
      client.release();
    }
  });

  it('lets the runtime role insert and read', async () => {
    await t.app().query(`INSERT INTO audit_probe.events (note) VALUES ('created')`);
    const { rows } = await t.app().query('SELECT note FROM audit_probe.events');
    expect(rows).toEqual([{ note: 'created' }]);
  });

  it('denies the runtime role UPDATE and DELETE', async () => {
    await t.app().query(`INSERT INTO audit_probe.events (note) VALUES ('created')`);
    expect(await sqlState(t.app().query(`UPDATE audit_probe.events SET note = 'x'`))).toBe('42501');
    expect(await sqlState(t.app().query('DELETE FROM audit_probe.events'))).toBe('42501');
  });

  it('blocks even the owner with KT001', async () => {
    await t.owner().query(`INSERT INTO audit_probe.events (note) VALUES ('created')`);
    expect(await sqlState(t.owner().query(`UPDATE audit_probe.events SET note = 'x'`))).toBe('KT001');
    expect(await sqlState(t.owner().query('DELETE FROM audit_probe.events'))).toBe('KT001');
  });

  it('stays append-only when grants are refreshed by a later migrate run', async () => {
    const client = await t.owner().connect();
    try {
      await grantRuntimeAccess(client);
    } finally {
      client.release();
    }
    await t.app().query(`INSERT INTO audit_probe.events (note) VALUES ('created')`);
    expect(await sqlState(t.app().query(`UPDATE audit_probe.events SET note = 'x'`))).toBe('42501');
  });
});
