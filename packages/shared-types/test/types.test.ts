// Type-level checks: the inferred types API code relies on.
import { describe, expectTypeOf, it } from 'vitest';
import type { CursorPageRequest, KoboJson, PageRequest, koboSchema } from '../src/index.js';
import type { z } from 'zod';

describe('inferred types', () => {
  it('pagination requests come out as plain numbers', () => {
    expectTypeOf<CursorPageRequest['limit']>().toEqualTypeOf<number>();
    expectTypeOf<PageRequest['page']>().toEqualTypeOf<number>();
  });

  it('money is a string on the wire and bigint in code', () => {
    expectTypeOf<KoboJson>().toEqualTypeOf<string>();
    expectTypeOf<z.output<typeof koboSchema>>().toEqualTypeOf<bigint>();
  });
});
