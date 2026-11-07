// A trade may only pin its own terms. A plain foreign key on the column alone would accept a
// pointer at another trade's version, which is how a trade ends up funded against a price nobody on
// it agreed to. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  ADDRESS,
  constraintName,
  insertRow,
  insertTermsVersion,
  insertTrade,
  insertUser,
} from '../support.js';

describe.runIf(infraEnabled)('pinning a terms version', () => {
  const t = useTestDatabase();

  const aTradeWithTerms = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    const termsId = await insertRow(t.app(), 'trade.trade_terms_versions', {
      trade_id: tradeId,
      version_number: 1,
      proposed_by_user_id: buyer,
      proposed_by_role: 'BUYER',
      item_amount_minor: '45000000',
      item_spec: JSON.stringify({ brand: 'Apple' }),
      inspection_window_hours: 72,
      delivery_grace_hours: 48,
      delivery_address: JSON.stringify(ADDRESS),
      ships_from_address: JSON.stringify(ADDRESS),
    });
    return { tradeId, termsId };
  };

  const pin = (tradeId: string, column: string, termsId: string) =>
    t.app().query(`UPDATE trade.trades SET ${column} = $2 WHERE id = $1`, [tradeId, termsId]);

  it('accepts a pin to a version of the same trade', async () => {
    const { tradeId, termsId } = await aTradeWithTerms();
    await expect(pin(tradeId, 'accepted_terms_version_id', termsId)).resolves.toBeTruthy();
    await expect(pin(tradeId, 'current_terms_version_id', termsId)).resolves.toBeTruthy();
  });

  it('refuses an accepted terms version belonging to another trade', async () => {
    const mine = await aTradeWithTerms();
    const theirs = await aTradeWithTerms();
    expect(await constraintName(pin(mine.tradeId, 'accepted_terms_version_id', theirs.termsId))).toBe(
      'trades_accepted_terms_fk',
    );
  });

  it('refuses a current terms version belonging to another trade', async () => {
    const mine = await aTradeWithTerms();
    const theirs = await aTradeWithTerms();
    expect(await constraintName(pin(mine.tradeId, 'current_terms_version_id', theirs.termsId))).toBe(
      'trades_current_terms_fk',
    );
  });

  it('refuses a pin at a version that does not exist', async () => {
    const { tradeId } = await aTradeWithTerms();
    expect(
      await constraintName(pin(tradeId, 'accepted_terms_version_id', '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4abc')),
    ).toBe('trades_accepted_terms_fk');
  });

  it('clears the pin when the trade and its versions are deleted together', async () => {
    const { tradeId, termsId } = await aTradeWithTerms();
    await pin(tradeId, 'accepted_terms_version_id', termsId);
    await expect(t.app().query('DELETE FROM trade.trades WHERE id = $1', [tradeId])).resolves.toBeTruthy();
  });

  describe('a proposal carries at least one address (migration 0039)', () => {
    const version = async (overrides: Record<string, unknown>) => {
      const buyer = await insertUser(t.app());
      const seller = await insertUser(t.app());
      const tradeId = await insertTrade(t.app(), { buyer, seller });
      return insertTermsVersion(t.app(), tradeId, buyer, overrides);
    };

    it('accepts either side alone', async () => {
      await expect(version({ ships_from_address: null })).resolves.toBeTruthy();
      await expect(version({ delivery_address: null })).resolves.toBeTruthy();
    });

    it('refuses a version with neither', async () => {
      expect(await constraintName(version({ delivery_address: null, ships_from_address: null }))).toBe(
        'trade_terms_has_an_address',
      );
    });
  });
});
