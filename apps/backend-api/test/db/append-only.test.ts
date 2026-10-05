import { describe, expect, it } from 'vitest';
import { appendOnly } from '../../src/db/helpers/appendOnly.js';

describe('appendOnly', () => {
  it('emits the trigger, then INSERT and SELECT only for the runtime role, as drizzle statements', () => {
    expect(appendOnly('trade.trade_state_changes').split('\n--> statement-breakpoint\n')).toEqual([
      'CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "trade"."trade_state_changes" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();',
      'REVOKE ALL ON "trade"."trade_state_changes" FROM komtru_app;',
      'GRANT INSERT, SELECT ON "trade"."trade_state_changes" TO komtru_app;',
    ]);
  });

  it.each([
    'trade_state_changes',
    'public.audit',
    'Trade.x',
    'trade.x;drop',
    'a.b.c',
    `trade.${'x'.repeat(64)}`,
  ])('rejects %s', (name) => {
    expect(() => appendOnly(name)).toThrow(TypeError);
  });
});
