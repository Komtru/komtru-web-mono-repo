// Contact channels against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  ContactInvalidError,
  ContactTakenError,
  applyVerificationProgress,
  attachEmail,
  attachPhone,
  findUserByVerifiedEmail,
  findUserByVerifiedPhone,
  markEmailVerified,
  markPhoneVerified,
  primaryContacts,
} from '../../../../src/modules/identity/services/contact.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { outboxEventTypes, seedUser } from '../support.js';

describe.runIf(infraEnabled)('contact channels', () => {
  const t = useTestDatabase();

  const userRow = async (userId: string) =>
    (
      await t.app().query<{
        status: string;
        verification_level: string;
        primary_email_id: string | null;
        primary_phone_id: string | null;
      }>(`SELECT status, verification_level, primary_email_id, primary_phone_id FROM identity.users WHERE id = $1`, [userId])
    ).rows[0];

  it('writes email and email_normal from one normaliseEmail call (T-030 rule)', async () => {
    const { userId } = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
    const attached = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId, email: 'J.ane+promo@GoogleMail.com' }));

    expect(attached).toMatchObject({ email: 'j.ane+promo@googlemail.com', emailNormal: 'jane@gmail.com' });
    const { rows } = await t
      .app()
      .query<{ email: string; email_normal: string }>(
        `SELECT email, email_normal FROM identity.user_emails WHERE id = $1`,
        [attached.emailId],
      );
    expect(rows[0]).toEqual({ email: 'j.ane+promo@googlemail.com', email_normal: 'jane@gmail.com' });
  });

  it('stores a phone in E.164 and nothing else', async () => {
    const { userId } = await seedUser(t.app());
    const attached = await t.db().transaction((tx) => attachPhone(tx, { userId, phone: '0802 341 5567' }));
    expect(attached.phoneE164).toBe('+2348023415567');
  });

  it('rejects an address normalisePhone or normaliseEmail cannot parse, before the CHECK sees it', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      t.db().transaction((tx) => attachPhone(tx, { userId, phone: 'not a number' })),
    ).rejects.toBeInstanceOf(ContactInvalidError);
    await expect(
      t.db().transaction((tx) => attachEmail(tx, { userId, email: 'not-an-email' })),
    ).rejects.toBeInstanceOf(ContactInvalidError);
  });

  it('points users.primary_email_id at the row flagged is_primary (T-030 deferred this here)', async () => {
    const { userId } = await seedUser(t.app());
    const first = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId, email: 'one@example.com', makePrimary: true }));
    expect((await userRow(userId))?.primary_email_id).toBe(first.emailId);

    const second = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId, email: 'two@example.com', makePrimary: true }));
    expect((await userRow(userId))?.primary_email_id).toBe(second.emailId);

    const { rows } = await t
      .app()
      .query<{ id: string }>(`SELECT id FROM identity.user_emails WHERE user_id = $1 AND is_primary`, [
        userId,
      ]);
    expect(rows.map((r) => r.id)).toEqual([second.emailId]);
  });

  it('finds a user only by a VERIFIED contact', async () => {
    const { userId } = await seedUser(t.app());
    const email = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId, email: 'jane@example.com', makePrimary: true }));

    expect(await t.db().transaction((tx) => findUserByVerifiedEmail(tx, 'jane@example.com'))).toBeNull();

    await t
      .db()
      .transaction((tx) => markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' }));
    expect(await t.db().transaction((tx) => findUserByVerifiedEmail(tx, 'jane@example.com'))).toEqual({
      userId,
      emailId: email.emailId,
    });
  });

  it('looks a phone up by its E.164 form', async () => {
    const { userId } = await seedUser(t.app());
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));
    await t.db().transaction((tx) => markPhoneVerified(tx, { userId, phoneId: phone.phoneId }));
    expect(await t.db().transaction((tx) => findUserByVerifiedPhone(tx, '+2348023415567'))).toEqual({
      userId,
      phoneId: phone.phoneId,
    });
  });

  it('turns a lost race for a verified address into a 409, not a 500', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    const emailA = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId: a.userId, email: 'shared@example.com' }));
    const emailB = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId: b.userId, email: 'shared@example.com' }));

    await t
      .db()
      .transaction((tx) =>
        markEmailVerified(tx, { userId: a.userId, emailId: emailA.emailId, source: 'otp' }),
      );

    await expect(
      t
        .db()
        .transaction((tx) =>
          markEmailVerified(tx, { userId: b.userId, emailId: emailB.emailId, source: 'otp' }),
        ),
    ).rejects.toBeInstanceOf(ContactTakenError);
  });

  it('leaves the caller transaction usable after losing the race (so the attempt is still charged)', async () => {
    // The 409 comes from a LIVE 23505, which aborts the whole Postgres transaction unless the
    // UPDATE is inside a savepoint. Without one, the caller's COMMIT is silently a ROLLBACK: the
    // OTP attempt charged a moment earlier is refunded, so the loser can replay the same code
    // without limit, and the §S10 audit row for the conflict is never written.
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    const emailA = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId: a.userId, email: 'shared@example.com' }));
    const emailB = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId: b.userId, email: 'shared@example.com' }));
    await t
      .db()
      .transaction((tx) =>
        markEmailVerified(tx, { userId: a.userId, emailId: emailA.emailId, source: 'otp' }),
      );

    const written = await t.db().transaction(async (tx) => {
      try {
        await markEmailVerified(tx, { userId: b.userId, emailId: emailB.emailId, source: 'otp' });
      } catch (error) {
        if (!(error instanceof ContactTakenError)) throw error;
      }
      // Still inside the same transaction, and it must still work.
      await attachPhone(tx, { userId: b.userId, phone: '08023415567' });
      return true;
    });

    expect(written).toBe(true);
    const { rows } = await t.app().query(`SELECT 1 FROM identity.user_phones WHERE user_id = $1`, [b.userId]);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent: verifying an already-verified row publishes nothing new', async () => {
    const { userId } = await seedUser(t.app());
    const email = await t.db().transaction((tx) => attachEmail(tx, { userId, email: 'jane@example.com' }));
    await t
      .db()
      .transaction((tx) => markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' }));
    await t
      .db()
      .transaction((tx) => markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' }));

    const types = await outboxEventTypes(t.app());
    expect(types.filter((type) => type === 'identity.email.verified')).toHaveLength(1);
  });

  it('reports the primary contact of each channel, verified or not', async () => {
    const { userId } = await seedUser(t.app());
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));

    expect(await t.db().transaction((tx) => primaryContacts(tx, userId))).toEqual({
      email: null,
      phone: { id: phone.phoneId, address: '+2348023415567', verified: false },
    });

    await t.db().transaction((tx) => markPhoneVerified(tx, { userId, phoneId: phone.phoneId }));
    expect((await t.db().transaction((tx) => primaryContacts(tx, userId))).phone?.verified).toBe(true);
  });

  it('moves PENDING_VERIFICATION to ACTIVE on the FIRST verified channel (M1 §9.1)', async () => {
    const { userId } = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));
    await t.db().transaction(async (tx) => {
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
      return applyVerificationProgress(tx, userId);
    });

    const row = await userRow(userId);
    expect(row?.status).toBe('ACTIVE');
    // Level 1 needs BOTH channels (M1 §2); one is not enough.
    expect(row?.verification_level).toBe('UNVERIFIED');
  });

  it('raises verification_level to CONTACT_VERIFIED only when BOTH channels are verified (M1 §2)', async () => {
    const { userId } = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));
    const email = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId, email: 'jane@example.com', makePrimary: true }));

    await t.db().transaction(async (tx) => {
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
      return applyVerificationProgress(tx, userId);
    });
    await t.db().transaction(async (tx) => {
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      return applyVerificationProgress(tx, userId);
    });

    expect((await userRow(userId))?.verification_level).toBe('CONTACT_VERIFIED');
    const types = await outboxEventTypes(t.app());
    expect(types.filter((x) => x === 'identity.user.status_changed')).toHaveLength(1);
    expect(types.filter((x) => x === 'identity.user.verification_level_changed')).toHaveLength(1);
  });

  it('publishes nothing on a second call with nothing to change', async () => {
    const { userId } = await seedUser(t.app(), { status: 'PENDING_VERIFICATION' });
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));
    await t.db().transaction(async (tx) => {
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
      return applyVerificationProgress(tx, userId);
    });
    await t.db().transaction((tx) => applyVerificationProgress(tx, userId));

    const types = await outboxEventTypes(t.app());
    expect(types.filter((x) => x === 'identity.user.status_changed')).toHaveLength(1);
  });

  it('never downgrades a user M6 has already raised past CONTACT_VERIFIED (M1 §2)', async () => {
    const { userId } = await seedUser(t.app());
    await t
      .owner()
      .query(`UPDATE identity.users SET verification_level = 'IDENTITY_VERIFIED' WHERE id = $1`, [userId]);
    const phone = await t
      .db()
      .transaction((tx) => attachPhone(tx, { userId, phone: '08023415567', makePrimary: true }));
    await t.db().transaction(async (tx) => {
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
      return applyVerificationProgress(tx, userId);
    });

    expect((await userRow(userId))?.verification_level).toBe('IDENTITY_VERIFIED');
  });

  it('sets reverify_after a year out on a verified phone (D4, SIM recycling)', async () => {
    const { userId } = await seedUser(t.app());
    const phone = await t.db().transaction((tx) => attachPhone(tx, { userId, phone: '08023415567' }));
    await t.db().transaction((tx) => markPhoneVerified(tx, { userId, phoneId: phone.phoneId }));

    const { rows } = await t.app().query<{ days: string }>(
      `SELECT extract(day from reverify_after - now())::text AS days
           FROM identity.user_phones WHERE id = $1`,
      [phone.phoneId],
    );
    expect(Number(rows[0]?.days)).toBeGreaterThan(360);
  });

  it('refuses to verify a row that belongs to another user', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    const email = await t
      .db()
      .transaction((tx) => attachEmail(tx, { userId: a.userId, email: 'jane@example.com' }));

    await t
      .db()
      .transaction((tx) =>
        markEmailVerified(tx, { userId: b.userId, emailId: email.emailId, source: 'otp' }),
      );
    const { rows } = await t
      .app()
      .query<{ verified_at: Date | null }>(`SELECT verified_at FROM identity.user_emails WHERE id = $1`, [
        email.emailId,
      ]);
    expect(rows[0]?.verified_at).toBeNull();
  });
});
