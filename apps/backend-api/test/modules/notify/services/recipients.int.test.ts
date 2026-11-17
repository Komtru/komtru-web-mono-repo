// Where a phone-change message goes (F-045, SP-M05). Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { resolveDestination } from '../../../../src/modules/notify/services/recipients.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser, insertVerifiedPhone } from '../support.js';

const PROVEN = '+2348032214471';
const OTHER = '+2349051182290';

describe.runIf(infraEnabled)('resolving a phone destination for a phone change', () => {
  const t = useTestDatabase();

  const addUnproven = (userId: string, phone: string) =>
    t
      .owner()
      .query(
        `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary) VALUES ($1, $2, 'NG', false)`,
        [userId, phone],
      );

  it('sends the code for the new number to the number being proven, not to the proven one', async () => {
    const userId = await insertUser(t.owner());
    await insertVerifiedPhone(t.owner(), userId, PROVEN);
    await addUnproven(userId, OTHER);
    const destination = await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'PENDING' });
    expect(destination?.address).toEqual([OTHER]);
    // The default is untouched: an ordinary message still goes to the proven number.
    expect((await resolveDestination(t.db(), userId, 'SMS'))?.address).toEqual([PROVEN]);
  });

  it('finds the number that was just replaced for the notice', async () => {
    const userId = await insertUser(t.owner());
    // After a change: the new number is primary and verified, the old one is neither.
    await insertVerifiedPhone(t.owner(), userId, OTHER);
    await addUnproven(userId, PROVEN);
    expect((await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'RETIRED' }))?.address).toEqual([
      PROVEN,
    ]);
    expect((await resolveDestination(t.db(), userId, 'SMS'))?.address).toEqual([OTHER]);
  });

  it('has no destination when there is no such number, and does not change the other channels', async () => {
    const userId = await insertUser(t.owner());
    await insertVerifiedPhone(t.owner(), userId, PROVEN);
    expect(await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'PENDING' })).toBeUndefined();
    expect(await resolveDestination(t.db(), userId, 'IN_APP', { phoneTarget: 'RETIRED' })).toEqual({
      address: [],
      masked: 'in-app',
    });
  });
});
