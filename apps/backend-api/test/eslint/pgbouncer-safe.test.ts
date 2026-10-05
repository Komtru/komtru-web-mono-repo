import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import pgbouncerSafe from '../../eslint-rules/pgbouncer-safe.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', parser: tseslint.parser },
});

const sessionSql = (code: string) => ({ code, errors: [{ messageId: 'sessionSql' }] });

tester.run('pgbouncer-safe', pgbouncerSafe, {
  valid: [
    "pool.query('SELECT pg_advisory_xact_lock($1)', [key]);",
    'db.execute(sql`SELECT pg_try_advisory_xact_lock(${key})`);',
    "pool.query('NOTIFY trades, $1');",
    "logger.info('api listening');",
    "logger.info('we listen to the customer');",
    "pool.query({ text: 'SELECT 1', values: [] });",
    'db.select().from(trades).prepare();',
    'app.listen(port);',
    "const update = 'UPDATE trade.trades SET state = $1 WHERE id = $2';",
  ],
  invalid: [
    sessionSql("pool.query('LISTEN trade_events');"),
    sessionSql('db.execute(sql`UNLISTEN *`);'),
    sessionSql("pool.query('SELECT pg_advisory_lock($1)', [key]);"),
    sessionSql("pool.query('select pg_try_advisory_lock_shared(1)');"),
    sessionSql("pool.query('PREPARE find_trade AS SELECT 1');"),
    sessionSql("pool.query('DEALLOCATE ALL');"),
    {
      code: "pool.query({ name: 'find-trade', text: 'SELECT 1' });",
      errors: [{ messageId: 'namedStatement' }],
    },
    { code: "db.select().from(trades).prepare('find_trades');", errors: [{ messageId: 'namedStatement' }] },
  ],
});
