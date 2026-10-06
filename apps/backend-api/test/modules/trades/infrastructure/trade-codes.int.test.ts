// Seven random digits collide: around 3,500 trades a repeat is likelier than not. The unique index
// is what guarantees uniqueness; this is the retry that makes the guarantee usable.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { trades } from '../../../../src/modules/trades/infrastructure/postgres/schema/trades.js';
import { withTradeCode } from '../../../../src/modules/trades/infrastructure/postgres/tradeCodes.js';
import type { ApiError } from '../../../../src/platform/errors.js';
import type { Tx } from '../../../../src/platform/events/publish.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertTrade, insertUser, testTradeCode } from '../support.js';

describe.runIf(infraEnabled)('withTradeCode', () => {
  const t = useTestDatabase();

  const createTrade =
    (tx: Tx, initiator: string, seller: string) =>
    async (tradeCode: string): Promise<string> => {
      const [row] = await tx
        .insert(trades)
        .values({
          tradeCode,
          initiatorUserId: initiator,
          initiatorRole: 'BUYER',
          buyerUserId: initiator,
          sellerUserId: seller,
          inspectionWindowHours: 72,
          deliveryGraceHours: 48,
        })
        .returning({ tradeCode: trades.tradeCode });
      return row!.tradeCode;
    };

  it('issues a code and inserts with it', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const code = await t.db().transaction((tx) => withTradeCode(tx, createTrade(tx, buyer, seller)));
    expect(code).toMatch(/^KMT-\d{7}-NG$/);
  });

  it('retries past a collision and leaves the caller transaction usable', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const taken = testTradeCode();
    await insertTrade(t.app(), { buyer, seller }, { trade_code: taken });

    const codes = [taken, taken, 'KMT-5550000-NG'];
    let issued = 0;
    const code = await t.db().transaction(async (tx) => {
      const result = await withTradeCode(tx, createTrade(tx, buyer, seller), {
        generate: () => codes[issued++]!,
      });
      // The caller's transaction survived the collisions, which is the whole point of the savepoint.
      await tx.select({ code: trades.tradeCode }).from(trades);
      return result;
    });
    expect(code).toBe('KMT-5550000-NG');
    expect(issued).toBe(3);
  });

  it('gives up with 409 CONFLICT rather than looping forever', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const taken = testTradeCode();
    await insertTrade(t.app(), { buyer, seller }, { trade_code: taken });

    let attempts = 0;
    try {
      await t.db().transaction((tx) =>
        withTradeCode(tx, createTrade(tx, buyer, seller), {
          attempts: 3,
          generate: () => {
            attempts += 1;
            return taken;
          },
        }),
      );
      expect.unreachable('should have given up');
    } catch (error) {
      expect((error as ApiError).status).toBe(409);
    }
    expect(attempts).toBe(3);
  });

  it('does not retry an error that is not a code collision', async () => {
    const buyer = await insertUser(t.app());
    let attempts = 0;
    await expect(
      t.db().transaction((tx) =>
        withTradeCode(
          tx,
          // Buyer and seller the same person: a CHECK, not a code collision, so it must not retry.
          (tradeCode) =>
            tx.insert(trades).values({
              tradeCode,
              initiatorUserId: buyer,
              initiatorRole: 'BUYER',
              buyerUserId: buyer,
              sellerUserId: buyer,
              inspectionWindowHours: 72,
              deliveryGraceHours: 48,
            }),
          {
            generate: () => {
              attempts += 1;
              return testTradeCode();
            },
          },
        ),
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
