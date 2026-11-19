// The applicant's half of T-055 against a real database: draft, submit (422 without the CAC documents),
// the case it registers, the log it writes and resubmission after changes were requested.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import {
  getMyApplication,
  saveDraft,
  submitApplication,
  type ApplicationDeps,
} from '../../../src/modules/merchant/services/application.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { outboxEventTypes, seedUser } from '../identity/support.js';
import { addFile, arrayWith, completeDraft, logger, stubPorts, STATE_ID } from './support.js';

describe.runIf(infraEnabled)('the applicant service (T-055)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  const setup = () => {
    const ports = stubPorts();
    const deps: ApplicationDeps = { db: db(), ports, logger };
    return { ports, deps };
  };
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await t.owner().query<{ n: string }>(sql, params)).rows[0]?.n);

  describe('draft', () => {
    it('creates the draft on first save and updates the same one after, field by field', async () => {
      const { deps } = setup();
      const { userId } = await seedUser(t.app());
      const first = await saveDraft(deps, userId, { businessName: ' Techedge ' });
      expect(first).toMatchObject({ status: 'DRAFT', canEdit: true, form: { businessName: 'Techedge' } });

      const second = await saveDraft(deps, userId, {
        addressLine: '12 Allen Avenue',
        cacRcNumber: 'rc 123456',
      });
      expect(second.id).toBe(first.id);
      expect(second.form).toMatchObject({
        businessName: 'Techedge',
        addressLine: '12 Allen Avenue',
        // The one normal form trust uses: no prefix, no spaces, upper case.
        // Normalisation keeps the entity prefix now: 'rc 123456' in, 'RC123456' stored. The prefix
        // names the kind of registration and the provider refuses the bare form.
        cacRcNumber: 'RC123456',
      });
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_applications`)).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_application_events`)).toBe(1);
    });

    it('lets two tabs save at once without making two live applications', async () => {
      const { deps } = setup();
      const { userId } = await seedUser(t.app());
      const results = await Promise.all([
        saveDraft(deps, userId, { businessName: 'A' }),
        saveDraft(deps, userId, { addressLine: 'B' }),
        saveDraft(deps, userId, { cacRcNumber: 'RC999999' }),
      ]);
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_applications`)).toBe(1);
    });

    it('replaces a document of the same type and keeps one row per type', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const first = addFile(ports, userId);
      const second = addFile(ports, userId);
      await saveDraft(deps, userId, { documents: [{ docType: 'CAC_CERTIFICATE', fileId: first }] });
      const view = await saveDraft(deps, userId, {
        documents: [{ docType: 'CAC_CERTIFICATE', fileId: second }],
      });
      expect(view.documents).toEqual([
        { docType: 'CAC_CERTIFICATE', label: 'CAC certificate', fileId: second },
      ]);
    });

    it('refuses what does not check out, naming each field', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const stranger = await seedUser(t.app());
      const strangersFile = addFile(ports, stranger.userId);
      const notKyc = addFile(ports, userId, { category: 'PROFILE_PHOTO' });

      await expect(
        saveDraft(deps, userId, {
          cacRcNumber: '??',
          categories: ['PHONES', 'YACHTS'],
          stateId: STATE_ID,
          cityId: randomUUID(),
          payoutAccountId: randomUUID(),
          documents: [
            { docType: 'CAC_CERTIFICATE', fileId: strangersFile },
            { docType: 'DIRECTOR_ID', fileId: notKyc },
          ],
        }),
      ).rejects.toMatchObject({
        status: 422,
        fieldErrors: arrayWith([
          expect.objectContaining({ path: 'cacRcNumber' }),
          expect.objectContaining({ path: 'categories' }),
          expect.objectContaining({ path: 'cityId' }),
          expect.objectContaining({ path: 'payoutAccountId' }),
          expect.objectContaining({ path: 'documents.CAC_CERTIFICATE' }),
          expect.objectContaining({ path: 'documents.DIRECTOR_ID' }),
        ]),
      });
      expect(await count(`SELECT count(*) AS n FROM merchant.merchant_applications`)).toBe(0);
    });

    it('refuses a payout account that belongs to someone else', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const other = await seedUser(t.app());
      const theirs = completeDraft(ports, other.userId).payoutAccountId;
      await expect(saveDraft(deps, userId, { payoutAccountId: theirs })).rejects.toMatchObject({
        status: 422,
      });
    });

    it('refuses an account that is not active, and one that is already a certified merchant', async () => {
      const { deps } = setup();
      const suspended = await seedUser(t.app(), { status: 'SUSPENDED' });
      await expect(saveDraft(deps, suspended.userId, { businessName: 'A' })).rejects.toMatchObject({
        status: 403,
      });

      const { userId } = await seedUser(t.app());
      const earned = await t.owner().query<{ id: string }>(
        `INSERT INTO merchant.merchant_applications (user_id, status, case_id, submission_count)
         VALUES ($1, 'APPROVED', $2, 1) RETURNING id`,
        [userId, randomUUID()],
      );
      await t.owner().query(
        `INSERT INTO merchant.merchant_profiles (user_id, application_id, business_name, business_type, storefront_slug, certified_at)
         VALUES ($1, $2, 'Shop', 'REGISTERED_BUSINESS', 'shop', now())`,
        [userId, earned.rows[0]?.id],
      );
      await expect(saveDraft(deps, userId, { businessName: 'A' })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('submit', () => {
    it('returns 422 without the CAC documents, and still lists what else is missing', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const draft = completeDraft(ports, userId);
      const view = await saveDraft(deps, userId, {
        ...draft,
        documents: [{ docType: 'DIRECTOR_ID', fileId: draft.documents[2]?.fileId ?? '' }],
      });

      await expect(
        submitApplication(deps, { userId, applicationId: view.id, mode: 'SUBMIT' }),
      ).rejects.toMatchObject({
        status: 422,
        title: 'The CAC documents are required',
        fieldErrors: [
          { path: 'documents.CAC_CERTIFICATE', message: 'is required' },
          { path: 'documents.STATUS_REPORT', message: 'is required' },
        ],
      });
      // Nothing happened: no case, still a draft, nothing queued or granted.
      expect((await getMyApplication(db(), userId))?.status).toBe('DRAFT');
      expect(await count(`SELECT count(*) AS n FROM cases.cases`)).toBe(0);
      expect(ports.enqueued).toHaveLength(0);
      expect(ports.granted).toHaveLength(0);
    });

    it('also refuses a form that is missing fields, naming them', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const draft = completeDraft(ports, userId);
      const view = await saveDraft(deps, userId, { documents: draft.documents });
      await expect(
        submitApplication(deps, { userId, applicationId: view.id, mode: 'SUBMIT' }),
      ).rejects.toMatchObject({
        status: 422,
        title: 'The application is not complete',
        fieldErrors: arrayWith([
          { path: 'businessName', message: 'is required' },
          { path: 'cacRcNumber', message: 'is required' },
          { path: 'payoutAccountId', message: 'is required' },
        ]),
      });
    });

    it('refuses a document that has not finished uploading', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const draft = completeDraft(ports, userId);
      const pending = addFile(ports, userId, { uploadState: 'PENDING' });
      const view = await saveDraft(deps, userId, {
        ...draft,
        documents: [...draft.documents, { docType: 'CAC_CERTIFICATE', fileId: pending }],
      });
      await expect(
        submitApplication(deps, { userId, applicationId: view.id, mode: 'SUBMIT' }),
      ).rejects.toMatchObject({
        status: 422,
        fieldErrors: [{ path: 'documents.CAC_CERTIFICATE', message: 'has not finished uploading' }],
      });
    });

    it('submits a complete application: a case, a log row, an event, grants and the evidence job', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const draft = completeDraft(ports, userId);
      const saved = await saveDraft(deps, userId, draft);

      const view = await submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' });
      expect(view).toMatchObject({ status: 'SUBMITTED', canEdit: false, submissionCount: 1 });
      expect(view.submittedAt).toBeInstanceOf(Date);

      const cases = await t.owner().query<{
        type: string;
        subject_type: string;
        subject_id: string;
        title: string;
        facts: Record<string, unknown>;
        sla_hours: number;
      }>(`SELECT type, subject_type, subject_id, title, facts, sla_hours FROM cases.cases`);
      expect(cases.rows).toHaveLength(1);
      expect(cases.rows[0]).toMatchObject({
        type: 'MERCHANT_APPLICATION',
        subject_type: 'merchant_application',
        subject_id: saved.id,
        title: 'Merchant application: Techedge Nigeria Ltd',
      });
      // The evidence matrix's scalars, for the advisory: complete form and documents, no identity yet.
      expect(cases.rows[0]?.facts).toMatchObject({
        checklistComplete: true,
        identityVerified: false,
        cacLookup: 'NOT_RUN',
        bankNameMatch: 'EXACT',
      });

      const application = (
        await t.owner().query<{ case_id: string }>(`SELECT case_id FROM merchant.merchant_applications`)
      ).rows[0];
      expect(application?.case_id).toBeTruthy();

      const log = await t
        .owner()
        .query<{ from_status: string | null; to_status: string; actor_type: string }>(
          `SELECT from_status, to_status, actor_type FROM merchant.merchant_application_events ORDER BY created_at, to_status`,
        );
      expect(log.rows.map((r) => [r.from_status, r.to_status, r.actor_type])).toEqual(
        expect.arrayContaining([
          [null, 'DRAFT', 'APPLICANT'],
          ['DRAFT', 'SUBMITTED', 'APPLICANT'],
        ]),
      );
      expect(await outboxEventTypes(t.owner())).toEqual(
        expect.arrayContaining(['merchant.application.submitted', 'cases.case.registered']),
      );

      expect([...ports.granted].sort()).toEqual(draft.documents.map((d) => d.fileId).sort());
      expect(ports.enqueued).toEqual([{ job: { applicationId: saved.id, attempt: 0 }, delayMs: undefined }]);
    });

    it('is not undone by a failed grant or a failed enqueue: the application is submitted', async () => {
      const { ports, deps } = setup();
      ports.failGrant = true;
      ports.failEnqueue = true;
      const { userId } = await seedUser(t.app());
      const saved = await saveDraft(deps, userId, completeDraft(ports, userId));
      await expect(
        submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' }),
      ).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it('refuses a second submit, another person’s application, and an edit while it is under review', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const other = await seedUser(t.app());
      const saved = await saveDraft(deps, userId, completeDraft(ports, userId));

      await expect(
        submitApplication(deps, { userId: other.userId, applicationId: saved.id, mode: 'SUBMIT' }),
      ).rejects.toMatchObject({ status: 404 });
      await submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' });
      await expect(
        submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' }),
      ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
      await expect(saveDraft(deps, userId, { businessName: 'Changed' })).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        submitApplication(deps, { userId, applicationId: saved.id, mode: 'RESUBMIT' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('resubmit after changes were requested', () => {
    it('registers a new case for the new submission and clears what was asked', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const saved = await saveDraft(deps, userId, completeDraft(ports, userId));
      await submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' });

      // What a decision does (T-055's review service owns it; here it is set directly).
      await t.owner().query(
        `UPDATE merchant.merchant_applications
            SET status = 'CHANGES_REQUESTED',
                changes_requested = '[{"kind":"DOCUMENT","key":"CAC_CERTIFICATE","note":"cut off"}]'::jsonb`,
      );
      await t.owner().query(`UPDATE cases.cases SET state = 'CLOSED', closed_at = now()`);

      const waiting = await getMyApplication(db(), userId);
      expect(waiting).toMatchObject({ status: 'CHANGES_REQUESTED', canEdit: true });
      expect(waiting?.changesRequested).toEqual([
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE', note: 'cut off' },
      ]);

      const replacement = addFile(ports, userId);
      await saveDraft(deps, userId, { documents: [{ docType: 'CAC_CERTIFICATE', fileId: replacement }] });
      const again = await submitApplication(deps, { userId, applicationId: saved.id, mode: 'RESUBMIT' });
      expect(again).toMatchObject({ status: 'SUBMITTED', submissionCount: 2, changesRequested: [] });

      const subjects = await t
        .owner()
        .query<{ subject_id: string; state: string }>(
          `SELECT subject_id, state FROM cases.cases ORDER BY case_number`,
        );
      expect(subjects.rows).toEqual([
        { subject_id: saved.id, state: 'CLOSED' },
        { subject_id: `${saved.id}:2`, state: 'OPEN' },
      ]);
      expect(ports.enqueued.map((e) => e.job.attempt)).toEqual([0, 0]);
    });

    it('cannot resubmit a draft', async () => {
      const { ports, deps } = setup();
      const { userId } = await seedUser(t.app());
      const saved = await saveDraft(deps, userId, completeDraft(ports, userId));
      await expect(
        submitApplication(deps, { userId, applicationId: saved.id, mode: 'RESUBMIT' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('status', () => {
    it('is null before the first application and shows the latest after a decision', async () => {
      const { deps } = setup();
      const { userId } = await seedUser(t.app());
      expect(await getMyApplication(db(), userId)).toBeNull();
      const saved = await saveDraft(deps, userId, { businessName: 'A' });
      await t
        .owner()
        .query(
          `UPDATE merchant.merchant_applications SET status = 'REJECTED', case_id = $1, submission_count = 1`,
          [randomUUID()],
        );
      expect(await getMyApplication(db(), userId)).toMatchObject({
        id: saved.id,
        status: 'REJECTED',
        canEdit: false,
      });
      // A rejected applicant may apply again: a new draft, and the status then shows the live one.
      const again = await saveDraft(deps, userId, { businessName: 'B' });
      expect(again.id).not.toBe(saved.id);
      expect((await getMyApplication(db(), userId))?.id).toBe(again.id);
    });
  });
});
