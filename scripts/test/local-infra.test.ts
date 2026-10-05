// Smoke test for docker-compose.yml. Runs only when KOMTRU_INFRA_TESTS=1, after `pnpm infra:up`.
import { Redis } from 'ioredis';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { LOCAL_INFRA } from '../env/local-infra.mjs';

const enabled = process.env.KOMTRU_INFRA_TESTS === '1';

describe.runIf(enabled)('local infrastructure', () => {
  it('serves queries through PgBouncer', async () => {
    const client = new pg.Client({ connectionString: LOCAL_INFRA.pooledUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ one: number }>('SELECT 1 AS one');
      expect(rows[0]?.one).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('runs PgBouncer in transaction pooling mode', async () => {
    const admin = new pg.Client({
      connectionString: LOCAL_INFRA.pooledUrl.replace(/\/[^/]+$/, '/pgbouncer'),
    });
    await admin.connect();
    try {
      // The PgBouncer admin console only speaks the simple query protocol.
      const result = await admin.query({ text: 'SHOW CONFIG', queryMode: 'simple' } as pg.QueryConfig);
      const poolMode = (result.rows as { key: string; value: string }[]).find((r) => r.key === 'pool_mode');
      expect(poolMode?.value).toBe('transaction');
    } finally {
      await admin.end();
    }
  });

  it('reaches Postgres directly for migrations', async () => {
    const client = new pg.Client({ connectionString: LOCAL_INFRA.directUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
      expect(rows[0]?.db).toBe('komtru_v2_dev');
    } finally {
      await client.end();
    }
  });

  it('answers Redis PING', async () => {
    const redis = new Redis(LOCAL_INFRA.redisUrl, { lazyConnect: true });
    await redis.connect();
    try {
      expect(await redis.ping()).toBe('PONG');
    } finally {
      redis.disconnect();
    }
  });

  it('serves the Mailpit API', async () => {
    const response = await fetch(`${LOCAL_INFRA.mailpitUrl}/api/v1/info`);
    expect(response.status).toBe(200);
  });
});
