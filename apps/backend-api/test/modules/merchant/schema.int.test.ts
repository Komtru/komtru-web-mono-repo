// T-055's migration, against a real database: the rules the schema enforces for the application, so a
// code path that forgets one cannot write the row.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { seedUser } from '../identity/support.js';

describe.runIf(infraEnabled)('merchant schema (migration 0050)', () => {
  const t = useTestDatabase();

  const insertApplication = async (userId: string, status = 'DRAFT') =>
    t.owner().query<{ id: string }>(
      `INSERT INTO merchant.merchant_applications (user_id, status, case_id, submission_count)
       VALUES ($1, $2::merchant.application_status, $3, $4) RETURNING id`,
      [userId, status, status === 'DRAFT' ? null : randomUUID(), status === 'DRAFT' ? 0 : 1],
    );

  it('allows at most one live application per user, and lets a rejected applicant apply again', async () => {
    const { userId } = await seedUser(t.app());
    await insertApplication(userId);
    await expect(insertApplication(userId)).rejects.toMatchObject({
      constraint: 'merchant_applications_one_live',
    });
    await expect(insertApplication(userId, 'SUBMITTED')).rejects.toMatchObject({
      constraint: 'merchant_applications_one_live',
    });

    await t
      .owner()
      .query(
        `UPDATE merchant.merchant_applications SET status = 'REJECTED', case_id = $2, submission_count = 1 WHERE user_id = $1`,
        [userId, randomUUID()],
      );
    await expect(insertApplication(userId)).resolves.toBeDefined();
  });

  it('lets two different users each hold a live application', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    await insertApplication(a.userId);
    await expect(insertApplication(b.userId)).resolves.toBeDefined();
  });

  it('refuses a submitted application with no case', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      t
        .owner()
        .query(
          `INSERT INTO merchant.merchant_applications (user_id, status, submission_count) VALUES ($1, 'SUBMITTED', 1)`,
          [userId],
        ),
    ).rejects.toMatchObject({ constraint: 'merchant_applications_case_after_draft' });
  });

  describe('the status and decision log', () => {
    const log = async (values: {
      actorType: string;
      actorUserId?: string | null;
      to: string;
      reason?: string | null;
      citation?: string | null;
    }) => {
      const { userId } = await seedUser(t.app());
      const { rows } = await insertApplication(userId);
      const applicationId = rows[0]?.id;
      await t.app().query(
        `INSERT INTO merchant.merchant_application_events
           (application_id, to_status, actor_type, actor_user_id, reason, policy_citation)
         VALUES ($1, $2::merchant.application_status, $3::merchant.event_actor_type, $4, $5, $6)`,
        [
          applicationId,
          values.to,
          values.actorType,
          values.actorUserId ?? null,
          values.reason ?? null,
          values.citation ?? null,
        ],
      );
      return applicationId;
    };

    it('only grows: an UPDATE or DELETE is refused, even for the owner', async () => {
      await log({ actorType: 'SYSTEM', to: 'SUBMITTED' });
      await expect(
        t.owner().query(`UPDATE merchant.merchant_application_events SET reason = 'edited'`),
      ).rejects.toMatchObject({ code: 'KT001' });
      await expect(t.owner().query(`DELETE FROM merchant.merchant_application_events`)).rejects.toMatchObject(
        {
          code: 'KT001',
        },
      );
    });

    it('refuses a staff decision without its reason or its policy citation', async () => {
      const { userId: staffId } = await seedUser(t.app());
      for (const to of ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']) {
        await expect(
          log({ actorType: 'STAFF', actorUserId: staffId, to, reason: 'because', citation: null }),
        ).rejects.toMatchObject({ constraint: 'merchant_application_events_staff_decision' });
        await expect(
          log({ actorType: 'STAFF', actorUserId: staffId, to, reason: '  ', citation: 'MER-1' }),
        ).rejects.toMatchObject({ constraint: 'merchant_application_events_staff_decision' });
      }
      await expect(
        log({
          actorType: 'STAFF',
          actorUserId: staffId,
          to: 'REJECTED',
          reason: 'because',
          citation: 'MER-1',
        }),
      ).resolves.toBeDefined();
    });

    it('does not ask a staff member taking the case for a citation, but does ask who took it', async () => {
      const { userId: staffId } = await seedUser(t.app());
      await expect(log({ actorType: 'STAFF', actorUserId: staffId, to: 'IN_REVIEW' })).resolves.toBeDefined();
      await expect(log({ actorType: 'STAFF', to: 'IN_REVIEW' })).rejects.toMatchObject({
        constraint: 'merchant_application_events_staff_actor',
      });
    });
  });

  it('keeps storefront slugs unique and URL-shaped, and one live badge per user', async () => {
    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    const profile = async (userId: string, slug: string) => {
      const applicationId = (await insertApplication(userId, 'APPROVED')).rows[0]?.id;
      return t.owner().query(
        `INSERT INTO merchant.merchant_profiles
           (user_id, application_id, business_name, business_type, storefront_slug, certified_at)
         VALUES ($1, $2, 'Shop', 'REGISTERED_BUSINESS', $3, now())`,
        [userId, applicationId, slug],
      );
    };
    await profile(a.userId, 'techedge');
    await expect(profile(b.userId, 'techedge')).rejects.toMatchObject({
      constraint: 'merchant_profiles_slug_unique',
    });
    await expect(profile(b.userId, 'Not A Slug')).rejects.toMatchObject({
      constraint: 'merchant_profiles_slug_shape',
    });

    const badge = (userId: string) =>
      t
        .owner()
        .query(`INSERT INTO merchant.merchant_badges (user_id, badge) VALUES ($1, 'VERIFIED_MERCHANT')`, [
          userId,
        ]);
    await badge(a.userId);
    await expect(badge(a.userId)).rejects.toMatchObject({ constraint: 'merchant_badges_one_live' });
    await t.owner().query(`UPDATE merchant.merchant_badges SET revoked_at = now()`);
    await expect(badge(a.userId)).resolves.toBeDefined();
  });

  it('ties a profile to the application that earned it, and a badge to a profile', async () => {
    const { userId } = await seedUser(t.app());
    await expect(
      t.owner().query(
        `INSERT INTO merchant.merchant_profiles
           (user_id, application_id, business_name, business_type, storefront_slug, certified_at)
         VALUES ($1, $2, 'Shop', 'REGISTERED_BUSINESS', 'orphan', now())`,
        [userId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      t
        .owner()
        .query(`INSERT INTO merchant.merchant_badges (user_id, badge) VALUES ($1, 'VERIFIED_MERCHANT')`, [
          userId,
        ]),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
