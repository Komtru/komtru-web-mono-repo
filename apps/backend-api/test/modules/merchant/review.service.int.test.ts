// The staff half of T-055 against a real database: the queue, the detail with its evidence matrix and
// signed document URLs, taking the case, and the three decisions, including that approval is ONE
// transaction (a failure at the last step leaves nothing behind).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { createCapabilityService, postgresBuyerFacts } from '../../../src/modules/identity/index.js';
import {
  getMyApplication,
  saveDraft,
  submitApplication,
  type ApplicationDeps,
} from '../../../src/modules/merchant/services/application.service.js';
import { endCertification } from '../../../src/modules/merchant/services/certification.service.js';
import {
  assignApplication,
  countAwaitingReview,
  decideApplication,
  getApplicationDetail,
  listApplications,
  viewDocument,
  type StaffActor,
} from '../../../src/modules/merchant/services/review.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { outboxEventTypes, seedUser } from '../identity/support.js';
import { addFile, completeDraft, logger, matching, stubPorts, type StubPorts } from './support.js';

describe.runIf(infraEnabled)('the staff review service (T-055)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  const ports = (): StubPorts => stubPorts();

  const count = async (sql: string, params: unknown[] = []) =>
    Number((await t.owner().query<{ n: string }>(sql, params)).rows[0]?.n);

  const staffActor = async (roles: string[] = ['KYC_ANALYST']): Promise<StaffActor> => ({
    userId: (await seedUser(t.app())).userId,
    roles,
  });

  /** An applicant whose complete application is SUBMITTED. */
  const submitted = async (p: StubPorts, name = 'Techedge Nigeria Ltd', categories = ['PHONES']) => {
    const { userId } = await seedUser(t.app());
    const deps: ApplicationDeps = { db: db(), ports: p, logger };
    const draft = { ...completeDraft(p, userId), businessName: name, categories };
    const saved = await saveDraft(deps, userId, draft);
    await submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' });
    return { userId, applicationId: saved.id, deps, draft };
  };

  const decide = (
    actor: StaffActor,
    applicationId: string,
    decision: Parameters<typeof decideApplication>[1]['decision'],
    over: { reason?: string; policyCitation?: string; ports?: StubPorts } = {},
  ) =>
    decideApplication(
      db(),
      {
        actor,
        applicationId,
        decision,
        reason: over.reason ?? 'Documents verified against the CAC record',
        policyCitation: over.policyCitation ?? 'MER-POL-2.1',
      },
      over.ports ?? stubPorts(),
    );

  describe('the queue', () => {
    it('lists submitted applications by SLA risk, never drafts, with filters and pages', async () => {
      const p = ports();
      const phones = await submitted(p, 'Phones Ltd', ['PHONES']);
      const laptops = await submitted(p, 'Laptops Ltd', ['LAPTOPS']);
      const third = await submitted(p, 'Both Ltd', ['PHONES', 'LAPTOPS']);
      await saveDraft({ db: db(), ports: p, logger }, (await seedUser(t.app())).userId, {
        businessName: 'Draft only',
      });
      // The clock that runs out first comes first, whatever order they arrived in.
      await t
        .owner()
        .query(`UPDATE cases.cases SET sla_due_at = now() + interval '1 hour' WHERE subject_id = $1`, [
          third.applicationId,
        ]);

      const all = await listApplications(db(), { show: 'open', page: 1, limit: 10 });
      expect(all.total).toBe(3);
      expect(all.items.map((item) => item.businessName)).toEqual(['Both Ltd', 'Phones Ltd', 'Laptops Ltd']);
      expect(all.items[0]).toMatchObject({
        caseNumber: matching(/^C-\d{6}$/),
        status: 'SUBMITTED',
        categories: ['PHONES', 'LAPTOPS'],
        applicantPublicId: matching(/^KMT-/),
      });

      const byCategory = await listApplications(db(), {
        show: 'open',
        category: 'LAPTOPS',
        page: 1,
        limit: 10,
      });
      expect(byCategory.items.map((item) => item.businessName).sort()).toEqual(['Both Ltd', 'Laptops Ltd']);

      const pageTwo = await listApplications(db(), { show: 'open', page: 2, limit: 2 });
      expect(pageTwo).toMatchObject({ page: 2, limit: 2, total: 3 });
      expect(pageTwo.items).toHaveLength(1);

      expect(phones.applicationId).toBeTruthy();
      expect(laptops.applicationId).toBeTruthy();
    });

    it('filters by status, and shows decided work only when asked for everything', async () => {
      const p = ports();
      const a = await submitted(p, 'A Ltd');
      await submitted(p, 'B Ltd');
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId: a.applicationId });
      await decide(staff, a.applicationId, { outcome: 'REJECT' });

      expect(
        (await listApplications(db(), { show: 'open', page: 1, limit: 10 })).items.map((i) => i.businessName),
      ).toEqual(['B Ltd']);
      expect(
        (await listApplications(db(), { show: 'all', page: 1, limit: 10 })).items.map((i) => i.businessName),
      ).toEqual(['B Ltd', 'A Ltd']);
      expect(
        (await listApplications(db(), { show: 'open', status: 'REJECTED', page: 1, limit: 10 })).items.map(
          (i) => i.businessName,
        ),
      ).toEqual(['A Ltd']);
      expect(await countAwaitingReview(db())).toEqual({ awaitingReview: 1 });
    });
  });

  describe('the detail', () => {
    it('serves the form, the evidence matrix and the advisory, and signs nothing', async () => {
      const p = ports();
      const { userId, applicationId, draft } = await submitted(p);
      await t
        .owner()
        .query(`UPDATE identity.users SET verification_level = 'IDENTITY_VERIFIED' WHERE id = $1`, [userId]);

      const detail = await getApplicationDetail({ db: db(), ports: p, logger }, { applicationId });

      expect(detail).toMatchObject({
        applicationId,
        status: 'SUBMITTED',
        form: {
          businessName: 'Techedge Nigeria Ltd',
          stateName: 'Lagos',
          cityName: 'Ikeja',
          cacRcNumber: 'RC123456',
        },
        applicant: {
          userId,
          verificationLevel: 2,
          verificationLevelName: 'IDENTITY_VERIFIED',
          trades: { total: 0, completed: 0 },
        },
      });
      // Documents are listed and viewable, but opening the page signs none of them and writes no log:
      // a document is signed when a person asks to see it.
      expect(detail.documents.map((d) => [d.docType, d.viewable])).toEqual([
        ['CAC_CERTIFICATE', true],
        ['STATUS_REPORT', true],
        ['DIRECTOR_ID', true],
      ]);
      expect(JSON.stringify(detail)).not.toMatch(/files\.test|url|fileId/);
      expect(p.signed).toHaveLength(0);
      void draft;

      expect(detail.evidence).toMatchObject({
        identityLevel: 2,
        cacLookup: { state: 'NOT_RUN' },
        documents: { complete: true, missing: [] },
        bankNameMatch: { state: 'EXACT', bankName: 'Access Bank', accountNumberMasked: '******5567' },
      });
      expect(detail.advisory).toMatchObject({ label: 'AI-suggested — not a decision' });
      expect(detail.advisory.suggestion).toBe('Review the checklist and decide');
      expect(detail.history.map((h) => h.toStatus)).toEqual(['DRAFT', 'SUBMITTED']);
    });

    it('reads the CAC lookup trust holds, and keeps the case facts current with it', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const requestId = randomUUID();
      await t.owner().query(
        `INSERT INTO trust.verification_requests (id, user_id, verification_type, status, target_level, expires_at, attempt_count)
         VALUES ($1, $2, 'CAC', 'PROVIDER_PENDING', 3, now() + interval '1 day', 1)`,
        [requestId, userId],
      );
      const deps = { db: db(), ports: p, logger };
      expect((await getApplicationDetail(deps, { applicationId })).evidence.cacLookup.state).toBe('PENDING');

      // The lookup finishes: a verified business whose number matches the application's. Stored in
      // the current normal form, prefix included — a row written before 2026-11-19 holds the
      // stripped number and would correctly NOT match, which is the documented consequence of that
      // change rather than a bug in this comparison.
      await t
        .owner()
        .query(`UPDATE trust.verification_requests SET status = 'APPROVED' WHERE id = $1`, [requestId]);
      await t.owner().query(
        `INSERT INTO trust.business_verifications
           (request_id, user_id, cac_rc_number, registered_business_name, business_type, cac_status, officers_match, provider, provider_reference, verified_at)
         VALUES ($1, $2, 'RC123456', 'TECHEDGE NIGERIA LIMITED', 'LIMITED_LIABILITY', 'active', true, 'FAKE', 'ref', now())`,
        [requestId, userId],
      );
      const detail = await getApplicationDetail(deps, { applicationId });
      expect(detail.evidence.cacLookup).toMatchObject({
        state: 'VERIFIED',
        registeredBusinessName: 'TECHEDGE NIGERIA LIMITED',
        cacStatus: 'active',
        officersMatch: true,
        rcMatchesApplication: true,
      });
      const facts = (
        await t.owner().query<{ facts: Record<string, unknown> }>(`SELECT facts FROM cases.cases`)
      ).rows[0]?.facts;
      expect(facts).toMatchObject({ cacLookup: 'VERIFIED' });
      // Viewing again with nothing changed writes nothing: the trail is not buried in identical syncs.
      const before = await count(`SELECT count(*) AS n FROM cases.case_trail WHERE type = 'FACTS_UPDATED'`);
      await getApplicationDetail(deps, { applicationId });
      expect(await count(`SELECT count(*) AS n FROM cases.case_trail WHERE type = 'FACTS_UPDATED'`)).toBe(
        before,
      );
    });

    it('counts the applicant’s trades as a party, as buyer or seller', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const other = await seedUser(t.app());
      // This file's database is its own clone: relax the two "fees and terms are frozen before payment"
      // checks so a completed trade can be a bare row. Only the party columns and the status matter here.
      await t.owner().query(`ALTER TABLE trade.trades DROP CONSTRAINT trades_fees_before_payment`);
      await t.owner().query(`ALTER TABLE trade.trades DROP CONSTRAINT trades_terms_before_payment`);
      const insertTrade = async (status: string, role: 'BUYER' | 'SELLER', n: number) => {
        const [buyer, seller] = role === 'BUYER' ? [userId, other.userId] : [other.userId, userId];
        // A trade reaches COMPLETED by transition, never by insert; the fixture steps around that guard.
        const client = await t.owner().connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL session_replication_role = replica');
          await client.query(
            `INSERT INTO trade.trades
               (trade_code, initiator_role, initiator_user_id, buyer_user_id, seller_user_id, status,
                inspection_window_hours, delivery_grace_hours)
             VALUES ($1, $2::trade.trade_initiator_role, $3, $4, $5, $6::trade.trade_status, 48, 24)`,
            [
              `KMT-${String(n).padStart(6, '0')}-NG`,
              role,
              role === 'BUYER' ? buyer : seller,
              buyer,
              seller,
              status,
            ],
          );
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      };
      await insertTrade('COMPLETED', 'BUYER', 1);
      await insertTrade('SETTLED', 'SELLER', 2);
      await insertTrade('DRAFT', 'SELLER', 3);
      const detail = await getApplicationDetail({ db: db(), ports: p, logger }, { applicationId });
      expect(detail.applicant.trades).toEqual({ total: 3, completed: 2 });
    });

    it('does not open a draft, and an unknown id is a 404', async () => {
      const p = ports();
      const { userId } = await seedUser(t.app());
      const draft = await saveDraft({ db: db(), ports: p, logger }, userId, { businessName: 'A' });
      const deps = { db: db(), ports: p, logger };
      await expect(getApplicationDetail(deps, { applicationId: draft.id })).rejects.toMatchObject({
        status: 404,
      });
      await expect(getApplicationDetail(deps, { applicationId: randomUUID() })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('shows a document that cannot be served as not viewable, and refuses to open it', async () => {
      const p = ports();
      const { applicationId, draft } = await submitted(p);
      const first = draft.documents[0];
      const file = first ? p.files.get(first.fileId) : undefined;
      if (first && file) p.files.set(first.fileId, { ...file, status: 'TOMBSTONED' });
      const deps = { db: db(), ports: p, logger };
      const detail = await getApplicationDetail(deps, { applicationId });
      expect(detail.documents.map((d) => d.viewable)).toEqual([false, true, true]);
      await expect(
        viewDocument(deps, { applicationId, docType: 'CAC_CERTIFICATE', viewer: await staffActor() }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('opening a document', () => {
    it('signs that one document for that viewer, on request, after re-asserting the grant', async () => {
      const p = ports();
      const { applicationId, draft } = await submitted(p);
      const viewer = await staffActor(['KYC_ANALYST']);
      const view = await viewDocument(
        { db: db(), ports: p, logger },
        { applicationId, docType: 'DIRECTOR_ID', viewer },
      );
      expect(view).toMatchObject({ docType: 'DIRECTOR_ID', label: 'Proprietor or director ID' });
      expect(view.url).toMatch(/^https:\/\/files\.test\//);
      expect(p.signed).toEqual([
        { fileId: draft.documents[2]?.fileId, viewer: { userId: viewer.userId, roles: ['KYC_ANALYST'] } },
      ]);
      expect(p.granted.at(-1)).toBe(draft.documents[2]?.fileId);
    });

    it('is refused once the application is decided, and for a document it does not have', async () => {
      const p = ports();
      const { applicationId } = await submitted(p);
      const deps = { db: db(), ports: p, logger };
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await expect(
        viewDocument(deps, { applicationId, docType: 'MEMORANDUM', viewer: staff }),
      ).rejects.toMatchObject({ status: 404 });
      await decide(staff, applicationId, { outcome: 'REJECT' }, { ports: p });
      p.signed.length = 0;
      await expect(
        viewDocument(deps, { applicationId, docType: 'CAC_CERTIFICATE', viewer: staff }),
      ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
      expect(p.signed).toHaveLength(0);
      const detail = await getApplicationDetail(deps, { applicationId });
      expect(detail.documents.every((d) => !d.viewable)).toBe(true);
    });
  });

  describe('who may decide', () => {
    it('refuses a reviewer their own application, to take or to decide', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const self: StaffActor = { userId, roles: ['KYC_ANALYST'] };
      await expect(assignApplication(db(), { actor: self, applicationId })).rejects.toMatchObject({
        status: 403,
      });
      // Even if the case were taken some other way (the generic cases route), the decision refuses.
      await t.owner().query(`UPDATE cases.cases SET owner_user_id = $1, state = 'INVESTIGATING'`, [userId]);
      await expect(decide(self, applicationId, { outcome: 'APPROVE' })).rejects.toMatchObject({
        status: 403,
      });
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM cases.case_decisions`)).toBe(0);
    });

    it('re-checks the applicant’s account at approval: suspended since submitting is not certified', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await t.owner().query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);
      await expect(decide(staff, applicationId, { outcome: 'APPROVE' })).rejects.toMatchObject({
        status: 409,
      });
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_profiles`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_badges`)).toBe(0);
      expect((await t.owner().query(`SELECT status FROM merchant.merchant_applications`)).rows).toEqual([
        { status: 'IN_REVIEW' },
      ]);
      // A rejection of the same application is still possible.
      await expect(decide(staff, applicationId, { outcome: 'REJECT' })).resolves.toMatchObject({
        status: 'REJECTED',
      });
    });
  });

  describe('reviewer access ends with the decision', () => {
    it.each<[string, Parameters<typeof decide>[2]]>([
      ['approved', { outcome: 'APPROVE' }],
      ['rejected', { outcome: 'REJECT' }],
      ['sent back', { outcome: 'REQUEST_CHANGES', requested: [{ kind: 'FIELD', key: 'businessName' }] }],
    ])('revokes the grants on every document when it is %s', async (_name, decision) => {
      const p = ports();
      const { applicationId, draft } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await decide(staff, applicationId, decision, { ports: p });
      expect([...p.revoked].sort()).toEqual(draft.documents.map((d) => d.fileId).sort());
    });

    it('revokes nothing when the decision fails, so a refused decision leaves the review open', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await t.owner().query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);
      await expect(decide(staff, applicationId, { outcome: 'APPROVE' }, { ports: p })).rejects.toBeDefined();
      expect(p.revoked).toHaveLength(0);
    });

    it('revokes the grant on a document the applicant replaces', async () => {
      const p = ports();
      const { userId, deps, draft } = await submitted(p);
      const old = draft.documents[0]?.fileId;
      await t.owner().query(`UPDATE merchant.merchant_applications SET status = 'CHANGES_REQUESTED'`);
      await saveDraft(deps, userId, {
        documents: [{ docType: 'CAC_CERTIFICATE', fileId: addFile(p, userId) }],
      });
      expect(p.revoked).toEqual([old]);
    });
  });

  describe('taking it', () => {
    it('moves the application to IN_REVIEW and gives the case to the taker, once', async () => {
      const p = ports();
      const { applicationId } = await submitted(p);
      const staff = await staffActor();
      const other = await staffActor();
      expect(await assignApplication(db(), { actor: staff, applicationId })).toMatchObject({
        status: 'IN_REVIEW',
        ownerUserId: staff.userId,
      });
      // Idempotent for the owner, refused for anyone else.
      await assignApplication(db(), { actor: staff, applicationId });
      await expect(assignApplication(db(), { actor: other, applicationId })).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await count(
          `SELECT count(*) AS n FROM merchant.merchant_application_events WHERE to_status = 'IN_REVIEW'`,
        ),
      ).toBe(1);
    });

    it('refuses a draft and a decided application', async () => {
      const p = ports();
      const { userId } = await seedUser(t.app());
      const draft = await saveDraft({ db: db(), ports: p, logger }, userId, { businessName: 'A' });
      await expect(
        assignApplication(db(), { actor: await staffActor(), applicationId: draft.id }),
      ).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('approval', () => {
    it('does everything in one transaction: capability, profile, badge, case, events, audit', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });

      const result = await decide(staff, applicationId, { outcome: 'APPROVE' });
      expect(result).toEqual({ applicationId, status: 'APPROVED', storefrontSlug: 'techedge-nigeria-ltd' });

      expect(
        (
          await t
            .owner()
            .query(
              `SELECT status FROM identity.user_capabilities WHERE user_id = $1 AND capability = 'MERCHANT'`,
              [userId],
            )
        ).rows,
      ).toEqual([{ status: 'ACTIVE' }]);
      const profile = (
        await t.owner().query<{
          storefront_slug: string;
          certified_at: Date | null;
          certification_status: string;
          application_id: string;
        }>(`SELECT storefront_slug, certified_at, certification_status, application_id FROM merchant.merchant_profiles WHERE user_id = $1`, [userId])
      ).rows[0];
      expect(profile).toMatchObject({
        storefront_slug: 'techedge-nigeria-ltd',
        certification_status: 'CERTIFIED',
        application_id: applicationId,
      });
      expect(profile?.certified_at).toBeInstanceOf(Date);
      expect(
        (
          await t
            .owner()
            .query(`SELECT badge, revoked_at FROM merchant.merchant_badges WHERE user_id = $1`, [userId])
        ).rows,
      ).toEqual([{ badge: 'VERIFIED_MERCHANT', revoked_at: null }]);

      // The case: decided with the reason and the citation, then closed.
      expect(
        (
          await t
            .owner()
            .query(`SELECT outcome, reason, policy_citation, decided_by_user_id FROM cases.case_decisions`)
        ).rows,
      ).toEqual([
        {
          outcome: 'APPROVED',
          reason: 'Documents verified against the CAC record',
          policy_citation: 'MER-POL-2.1',
          decided_by_user_id: staff.userId,
        },
      ]);
      expect((await t.owner().query(`SELECT state FROM cases.cases`)).rows).toEqual([{ state: 'CLOSED' }]);

      // The admin action log carries the decision's reason and citation, and the capability change.
      const audit = await t.owner().query<{ action: string; metadata: Record<string, unknown> }>(
        `SELECT action, metadata FROM identity.identity_audit_log
          WHERE action IN ('ADMIN_CASE_DECIDED', 'CAPABILITY_ACTIVATED') ORDER BY action`,
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['ADMIN_CASE_DECIDED', 'CAPABILITY_ACTIVATED']);
      expect(audit.rows[0]?.metadata).toMatchObject({
        reason: 'Documents verified against the CAC record',
        policyCitation: 'MER-POL-2.1',
      });

      // The status log: a staff row with the reason and citation.
      expect(
        (
          await t
            .owner()
            .query(
              `SELECT to_status, actor_type, reason, policy_citation FROM merchant.merchant_application_events WHERE to_status = 'APPROVED'`,
            )
        ).rows,
      ).toEqual([
        {
          to_status: 'APPROVED',
          actor_type: 'STAFF',
          reason: 'Documents verified against the CAC record',
          policy_citation: 'MER-POL-2.1',
        },
      ]);

      expect(await outboxEventTypes(t.owner())).toEqual(
        expect.arrayContaining(['merchant.profile.certified', 'merchant.application.decided']),
      );
      const decided = (
        await t
          .owner()
          .query<{ payload: Record<string, unknown> }>(
            `SELECT payload FROM platform.outbox WHERE event_type = 'merchant.application.decided'`,
          )
      ).rows[0]?.payload;
      expect(decided).toMatchObject({
        applicationId,
        userId,
        outcome: 'APPROVED',
        decidedByUserId: staff.userId,
      });

      // Certification does not stop the merchant buying (owner ruling 2026-11-20).
      expect(await createCapabilityService({ facts: postgresBuyerFacts(db()) }).canActAsBuyer(userId)).toBe(
        true,
      );
    });

    it('is atomic: a failure at the last step leaves no capability, profile, badge or decision', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      // The decided event is the last thing the transaction writes; make that insert fail.
      await t.owner().query(`
        CREATE OR REPLACE FUNCTION public.test_refuse_decided() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'outbox refused the decided event'; END $$`);
      await t.owner().query(`
        CREATE TRIGGER test_refuse_decided BEFORE INSERT ON platform.outbox
        FOR EACH ROW WHEN (NEW.event_type = 'merchant.application.decided')
        EXECUTE FUNCTION public.test_refuse_decided()`);
      try {
        await expect(decide(staff, applicationId, { outcome: 'APPROVE' })).rejects.toThrow(
          /insert into "platform"."outbox"/,
        );
      } finally {
        await t.owner().query(`DROP TRIGGER test_refuse_decided ON platform.outbox`);
        await t.owner().query(`DROP FUNCTION public.test_refuse_decided()`);
      }

      expect(
        await count(`SELECT count(*) AS n FROM identity.user_capabilities WHERE user_id = $1`, [userId]),
      ).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_profiles`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_badges`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM cases.case_decisions`)).toBe(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM identity.identity_audit_log WHERE action IN ('ADMIN_CASE_DECIDED','CAPABILITY_ACTIVATED')`,
        ),
      ).toBe(0);
      expect(await outboxEventTypes(t.owner())).not.toContain('merchant.profile.certified');
      expect((await t.owner().query(`SELECT status FROM merchant.merchant_applications`)).rows).toEqual([
        { status: 'IN_REVIEW' },
      ]);
      expect((await t.owner().query(`SELECT state FROM cases.cases`)).rows).toEqual([
        { state: 'INVESTIGATING' },
      ]);

      // And the application is still decidable once the fault is gone.
      await expect(decide(staff, applicationId, { outcome: 'APPROVE' })).resolves.toMatchObject({
        status: 'APPROVED',
      });
    });

    it('gives two merchants with the same name different storefront slugs', async () => {
      const p = ports();
      const staff = await staffActor();
      const slugs: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const { applicationId } = await submitted(p, 'Same Name Ltd');
        await assignApplication(db(), { actor: staff, applicationId });
        slugs.push((await decide(staff, applicationId, { outcome: 'APPROVE' })).storefrontSlug ?? '');
      }
      expect(slugs).toEqual(['same-name-ltd', 'same-name-ltd-2', 'same-name-ltd-3']);
    });

    it('survives losing a slug to another merchant approved at the same moment', async () => {
      const p = ports();
      const staff = await staffActor();
      const a = await submitted(p, 'Race Ltd');
      const b = await submitted(p, 'Race Ltd');
      await assignApplication(db(), { actor: staff, applicationId: a.applicationId });
      await assignApplication(db(), { actor: staff, applicationId: b.applicationId });
      const results = await Promise.all([
        decide(staff, a.applicationId, { outcome: 'APPROVE' }),
        decide(staff, b.applicationId, { outcome: 'APPROVE' }),
      ]);
      expect(new Set(results.map((r) => r.storefrontSlug)).size).toBe(2);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_profiles`)).toBe(2);
    });
  });

  describe('request changes', () => {
    it('names the documents and fields, closes the case, and lets the applicant resubmit', async () => {
      const p = ports();
      const { userId, applicationId, deps } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });

      const requested = [
        { kind: 'DOCUMENT' as const, key: 'CAC_CERTIFICATE', note: 'The scan is cut off' },
        { kind: 'FIELD' as const, key: 'cacRcNumber' },
      ];
      expect(
        await decide(
          staff,
          applicationId,
          { outcome: 'REQUEST_CHANGES', requested },
          { reason: 'Certificate unreadable' },
        ),
      ).toEqual({ applicationId, status: 'CHANGES_REQUESTED' });

      // Nothing on the account moved.
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_profiles`)).toBe(0);
      expect((await t.owner().query(`SELECT state FROM cases.cases`)).rows).toEqual([{ state: 'CLOSED' }]);

      const mine = await getMyApplication(db(), userId);
      expect(mine).toMatchObject({
        status: 'CHANGES_REQUESTED',
        canEdit: true,
        changesRequested: requested,
        lastDecision: { outcome: 'CHANGES_REQUESTED', reason: 'Certificate unreadable' },
      });
      // The applicant is told the reason, never the internal policy citation.
      expect(JSON.stringify(mine)).not.toContain('MER-POL-2.1');

      const decided = (
        await t
          .owner()
          .query<{ payload: { requested: unknown[] } }>(
            `SELECT payload FROM platform.outbox WHERE event_type = 'merchant.application.decided'`,
          )
      ).rows[0]?.payload;
      expect(decided?.requested).toEqual([
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' },
        { kind: 'FIELD', key: 'cacRcNumber' },
      ]);

      // The applicant fixes it and resubmits: a new case, back in the queue.
      await saveDraft(deps, userId, {
        documents: [{ docType: 'CAC_CERTIFICATE', fileId: [...p.files.keys()][0] ?? '' }],
      });
      const again = await submitApplication(deps, { userId, applicationId, mode: 'RESUBMIT' });
      expect(again.status).toBe('SUBMITTED');
      expect((await listApplications(db(), { show: 'open', page: 1, limit: 10 })).items).toHaveLength(1);
    });

    it('needs at least one named item, and only ones the form has', async () => {
      const p = ports();
      const { applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await expect(
        decide(staff, applicationId, { outcome: 'REQUEST_CHANGES', requested: [] }),
      ).rejects.toMatchObject({
        status: 422,
      });
      await expect(
        decide(staff, applicationId, {
          outcome: 'REQUEST_CHANGES',
          requested: [{ kind: 'DOCUMENT', key: 'PASSPORT' }],
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect((await t.owner().query(`SELECT status FROM merchant.merchant_applications`)).rows).toEqual([
        { status: 'IN_REVIEW' },
      ]);
    });
  });

  describe('rejection', () => {
    it('rejects, leaves the account untouched, and lets the applicant apply again', async () => {
      const p = ports();
      const { userId, applicationId, deps } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      expect(
        await decide(
          staff,
          applicationId,
          { outcome: 'REJECT' },
          { reason: 'CAC number belongs to another business' },
        ),
      ).toEqual({
        applicationId,
        status: 'REJECTED',
      });
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_profiles`)).toBe(0);
      expect(await getMyApplication(db(), userId)).toMatchObject({
        status: 'REJECTED',
        lastDecision: { outcome: 'REJECTED', reason: 'CAC number belongs to another business' },
      });
      await expect(saveDraft(deps, userId, { businessName: 'Second try' })).resolves.toMatchObject({
        status: 'DRAFT',
      });
    });
  });

  describe('what every decision requires', () => {
    it('refuses a missing reason or policy citation, writing nothing', async () => {
      const p = ports();
      const { applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await expect(
        decide(staff, applicationId, { outcome: 'APPROVE' }, { reason: '   ' }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        decide(staff, applicationId, { outcome: 'REJECT' }, { policyCitation: ' ' }),
      ).rejects.toMatchObject({
        status: 422,
      });
      expect(await count(`SELECT count(*) AS n FROM cases.case_decisions`)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
    });

    it('is the case owner’s alone, and only while the application awaits a decision', async () => {
      const p = ports();
      const { applicationId } = await submitted(p);
      const owner = await staffActor();
      const bystander = await staffActor();
      await expect(decide(owner, applicationId, { outcome: 'REJECT' })).rejects.toMatchObject({
        status: 409,
      });
      await assignApplication(db(), { actor: owner, applicationId });
      await expect(decide(bystander, applicationId, { outcome: 'REJECT' })).rejects.toMatchObject({
        status: 409,
      });
      await decide(owner, applicationId, { outcome: 'REJECT' });
      await expect(decide(owner, applicationId, { outcome: 'APPROVE' })).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
    });
  });

  describe('ending certification', () => {
    const certified = async (p: StubPorts) => {
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await decide(staff, applicationId, { outcome: 'APPROVE' });
      return userId;
    };

    it('suspends: capability SUSPENDED, buying restored, badge revoked, the event published', async () => {
      const userId = await certified(ports());
      await endCertification(db(), { userId, kind: 'SUSPENDED', reason: 'Under investigation' });
      expect(
        (
          await t
            .owner()
            .query(`SELECT status, suspension_reason FROM identity.user_capabilities WHERE user_id = $1`, [
              userId,
            ])
        ).rows,
      ).toEqual([{ status: 'SUSPENDED', suspension_reason: 'Under investigation' }]);
      expect(
        (
          await t
            .owner()
            .query(
              `SELECT certification_status, certification_ended_at IS NOT NULL AS ended FROM merchant.merchant_profiles`,
            )
        ).rows,
      ).toEqual([{ certification_status: 'SUSPENDED', ended: true }]);
      expect(
        (await t.owner().query(`SELECT revoked_at IS NOT NULL AS revoked FROM merchant.merchant_badges`))
          .rows,
      ).toEqual([{ revoked: true }]);
      expect(await createCapabilityService({ facts: postgresBuyerFacts(db()) }).canActAsBuyer(userId)).toBe(
        true,
      );
      const event = (
        await t
          .owner()
          .query<{ payload: Record<string, unknown> }>(
            `SELECT payload FROM platform.outbox WHERE event_type = 'merchant.profile.certification_revoked'`,
          )
      ).rows[0]?.payload;
      expect(event).toMatchObject({ userId, kind: 'SUSPENDED', reason: 'Under investigation' });
    });

    it('revokes, and refuses an account that is not a merchant', async () => {
      const userId = await certified(ports());
      await endCertification(db(), { userId, kind: 'REVOKED', reason: 'Fraud', actorUserId: null });
      expect((await t.owner().query(`SELECT status FROM identity.user_capabilities`)).rows).toEqual([
        { status: 'REVOKED' },
      ]);
      await expect(
        endCertification(db(), { userId, kind: 'REVOKED', reason: 'Again' }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        endCertification(db(), { userId: (await seedUser(t.app())).userId, kind: 'SUSPENDED', reason: 'x' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('does not let an ended certification back through the ordinary queue', async () => {
      const p = ports();
      const userId = await certified(p);
      await endCertification(db(), { userId, kind: 'SUSPENDED', reason: 'Investigation' });
      const deps: ApplicationDeps = { db: db(), ports: p, logger };
      await expect(saveDraft(deps, userId, completeDraft(p, userId))).rejects.toMatchObject({
        status: 409,
        title: 'Your merchant certification was ended',
      });
      expect((await t.owner().query(`SELECT status FROM identity.user_capabilities`)).rows).toEqual([
        { status: 'SUSPENDED' },
      ]);
    });

    it('refuses to certify an account that already has a profile, even if an application got through', async () => {
      const p = ports();
      const { userId, applicationId } = await submitted(p);
      const staff = await staffActor();
      await assignApplication(db(), { actor: staff, applicationId });
      await t.owner().query(
        `INSERT INTO merchant.merchant_profiles (user_id, application_id, business_name, business_type, storefront_slug, certification_status, certified_at, certification_ended_at)
         VALUES ($1, $2, 'Old', 'REGISTERED_BUSINESS', 'old', 'SUSPENDED', now(), now())`,
        [userId, applicationId],
      );
      await expect(decide(staff, applicationId, { outcome: 'APPROVE' })).rejects.toMatchObject({
        status: 409,
      });
      expect(await count(`SELECT count(*) AS n FROM identity.user_capabilities`)).toBe(0);
    });
  });
});
