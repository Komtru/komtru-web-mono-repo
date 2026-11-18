// F-081: proving a contact you already hold, or adding one you never gave.
//
// The rule the whole feature rests on is `ALREADY_VERIFIED`: `start` may only ever write an
// UNVERIFIED row, so no request here can move a contact somebody has already proven. That is why
// this flow needs no step-up, unlike F-045's phone change.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { startContactVerification } from '../../../../src/modules/identity/services/contact-verify.service.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

const hasher = createHmacHasher('pepper'.padEnd(32, 'x'));

describe.runIf(infraEnabled)('startContactVerification (F-081)', () => {
  const t = useTestDatabase();

  const deps = () => ({ db: t.db(), logger: testLogger, otpHasher: hasher });

  const start = (userId: string, channel: 'EMAIL' | 'PHONE', address?: string) =>
    startContactVerification(deps(), {
      userId,
      channel,
      ...(address === undefined ? {} : { address }),
      ip: null,
      userAgent: null,
    });

  const addEmail = (userId: string, email: string, verified: boolean) =>
    t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, $2, $2, true, ${verified ? 'now()' : 'NULL'})`,
      [userId, email],
    );

  const addPhone = (userId: string, phone: string, verified: boolean) =>
    t.owner().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', ${verified ? 'true' : 'false'}, ${verified ? 'now()' : 'NULL'})`,
      [userId, phone],
    );

  const emailsOf = async (userId: string) =>
    (
      await t.owner().query<{ email_normal: string; verified: boolean }>(
        `SELECT email_normal, verified_at IS NOT NULL AS verified
           FROM identity.user_emails WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      )
    ).rows;

  const challengeCount = async () =>
    Number(
      (await t.owner().query<{ n: string }>(`SELECT count(*) AS n FROM identity.otp_challenges`)).rows[0]
        ?.n ?? '0',
    );

  it('sends a code to the unverified address already on file', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'unproven@example.test', false);

    expect(await start(userId, 'EMAIL')).toMatchObject({ outcome: 'STARTED', delivered: true });
  });

  it('adds the address when the account has none', async () => {
    const { userId } = await seedUser(t.app());

    expect(await start(userId, 'EMAIL', 'fresh@example.test')).toMatchObject({ outcome: 'STARTED' });
    expect(await emailsOf(userId)).toEqual([
      expect.objectContaining({ email_normal: 'fresh@example.test', verified: false }),
    ]);
  });

  it('requires an address when the account has none', async () => {
    const { userId } = await seedUser(t.app());

    expect(await start(userId, 'EMAIL')).toEqual({ outcome: 'NO_ADDRESS' });
  });

  it('replaces an unverified address when a new one is supplied', async () => {
    const { userId } = await seedUser(t.app());
    await start(userId, 'EMAIL', 'typo@example.test');
    await start(userId, 'EMAIL', 'right@example.test');

    expect(await emailsOf(userId)).toEqual([expect.objectContaining({ email_normal: 'right@example.test' })]);
  });

  it('normalises case and whitespace before storing', async () => {
    const { userId } = await seedUser(t.app());

    await start(userId, 'EMAIL', '  Foo@X.com ');

    expect(await emailsOf(userId)).toEqual([expect.objectContaining({ email_normal: 'foo@x.com' })]);
  });

  it('refuses a channel that is already verified, and issues no code', async () => {
    const { userId } = await seedUser(t.app());
    await addPhone(userId, '+2348100000010', true);
    const before = await challengeCount();

    expect(await start(userId, 'PHONE')).toEqual({ outcome: 'ALREADY_VERIFIED' });
    expect(await challengeCount()).toBe(before);
  });

  it('refuses to replace a verified address with a new one', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'proven@example.test', true);

    expect(await start(userId, 'EMAIL', 'attacker@example.test')).toEqual({
      outcome: 'ALREADY_VERIFIED',
    });
    expect(await emailsOf(userId)).toEqual([
      expect.objectContaining({ email_normal: 'proven@example.test' }),
    ]);
  });

  it('refuses an address somebody else has already verified', async () => {
    const { userId: other } = await seedUser(t.app());
    await addEmail(other, 'taken@example.test', true);
    const { userId } = await seedUser(t.app());

    expect(await start(userId, 'EMAIL', 'taken@example.test')).toEqual({ outcome: 'TAKEN' });
  });

  it('refuses an address that cannot be made canonical', async () => {
    const { userId } = await seedUser(t.app());

    expect(await start(userId, 'EMAIL', 'not-an-address')).toEqual({ outcome: 'INVALID_ADDRESS' });
  });

  it('reports a spent send budget rather than claiming a code was sent', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'budget@example.test', false);

    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) results.push(await start(userId, 'EMAIL'));

    expect(results.at(-1)).toMatchObject({ outcome: 'STARTED', delivered: false });
  });
});
