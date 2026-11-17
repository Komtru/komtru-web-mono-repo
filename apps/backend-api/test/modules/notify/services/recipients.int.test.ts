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

  const addInState = (userId: string, phone: string, state: string) =>
    t
      .owner()
      .query(
        `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, change_state) VALUES ($1, $2, 'NG', false, $3)`,
        [userId, phone, state],
      );

  it('sends the code for the new number to the number being proven, not to the proven one', async () => {
    const userId = await insertUser(t.owner());
    await insertVerifiedPhone(t.owner(), userId, PROVEN);
    await addInState(userId, OTHER, 'PENDING');
    const destination = await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'PENDING' });
    expect(destination?.address).toEqual([OTHER]);
    // The default is untouched: an ordinary message still goes to the proven number.
    expect((await resolveDestination(t.db(), userId, 'SMS'))?.address).toEqual([PROVEN]);
  });

  it('finds the number that was just replaced for the notice', async () => {
    const userId = await insertUser(t.owner());
    // After a change: the new number is primary and verified, the old one is neither.
    await insertVerifiedPhone(t.owner(), userId, OTHER);
    await addInState(userId, PROVEN, 'RETIRED');
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

  it('does not take an unproven number that is in no change, however it was added', async () => {
    const userId = await insertUser(t.owner());
    await insertVerifiedPhone(t.owner(), userId, PROVEN);
    await addInState(userId, OTHER, 'NONE');
    expect(await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'PENDING' })).toBeUndefined();
    expect(await resolveDestination(t.db(), userId, 'SMS', { phoneTarget: 'RETIRED' })).toBeUndefined();
  });

  it('refuses a second pending number, and a second retired one, for a user: the database holds the invariant', async () => {
    const userId = await insertUser(t.owner());
    await insertVerifiedPhone(t.owner(), userId, PROVEN);
    await addInState(userId, OTHER, 'PENDING');
    await expect(addInState(userId, '+2349051182291', 'PENDING')).rejects.toMatchObject({ code: '23505' });
    await addInState(userId, '+2349051182292', 'RETIRED');
    await expect(addInState(userId, '+2349051182293', 'RETIRED')).rejects.toMatchObject({ code: '23505' });
    // And a number in a change cannot claim to be proven.
    await expect(
      t
        .owner()
        .query(
          `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at, change_state) VALUES ($1, '+2349051182294', 'NG', false, now(), 'PENDING')`,
          [userId],
        ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
