// The database's copy of the state machine, emitted from TRANSITIONS so the two cannot be typed
// twice and drift. Put the output in a custom migration (`pnpm db:generate --custom`); a unit test
// asserts the shipped migration still contains the current output, so changing the map without
// regenerating fails loudly rather than leaving Postgres enforcing last week's rules.
import { transitionTriples } from './stateMachine.js';

/**
 * `trade.is_valid_transition(action, from, to)`. IMMUTABLE so a CHECK or a generated column could
 * use it later, and so the planner may fold it; the edge list only changes by migration.
 */
export function transitionFunctionSql(): string {
  const rows = transitionTriples()
    .map(([action, from, to]) => `    ('${action}', '${from}', '${to}')`)
    .join(',\n');
  return [
    'CREATE OR REPLACE FUNCTION trade.is_valid_transition(',
    '  action trade.trade_action, from_status trade.trade_status, to_status trade.trade_status',
    ') RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$',
    '  SELECT (action::text, from_status::text, to_status::text) IN (',
    rows,
    '  );',
    '$$;',
  ].join('\n');
}
