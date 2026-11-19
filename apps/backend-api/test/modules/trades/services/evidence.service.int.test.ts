// F-028 (CWT-S13): attaching evidence to a trade and reading it back, against the real database.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_FILES_PER_EVENT } from '../../../../src/modules/trades/domain/evidence.js';
import { attachEvidence, listEvidence } from '../../../../src/modules/trades/services/evidence.service.js';
import type { EvidenceDeps } from '../../../../src/modules/trades/services/evidencePorts.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertRow } from '../support.js';
import { failure, newWorld, person, tradeAt, type FakeWorld } from './fulfilment-support.js';

describe.runIf(infraEnabled)('trade evidence (F-028 CWT-S13)', () => {
  const t = useTestDatabase();
  const world: FakeWorld = newWorld();
  const progress = new Map<string, { uploaderUserId: string; uploadState: string; status: string }>();
  const grants: { fileIds: readonly string[]; to: string }[] = [];
  const grantFails = { on: false };

  const deps = (): EvidenceDeps => ({
    db: t.db(),
    proofFiles: (_tx, ids) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const f = world.files.get(id);
          return f ? [{ id, ...f }] : [];
        }),
      ),
    fileProgress: (_tx, ids) =>
      Promise.resolve(new Map(ids.flatMap((id) => (progress.has(id) ? [[id, progress.get(id)!]] : [])))),
    grantEvidenceAccess: (_tx, fileIds, to) => {
      if (grantFails.on) return Promise.reject(new Error('grant failed'));
      grants.push({ fileIds, to });
      return Promise.resolve();
    },
  });

  /**
   * A READY private upload owned by `owner`.
   *
   * DISPUTE_EVIDENCE, not OTHER. The fixture used to describe a file the platform cannot store —
   * `OTHER` may only be PRIVATE_OWNER or INTERNAL_ONLY, never PRIVATE_CASE — so this suite proved
   * the service accepted a combination no upload could ever produce.
   */
  const upload = (owner: string, overrides: Record<string, unknown> = {}): string => {
    const id = randomUUID();
    world.files.set(id, {
      contentType: 'image/jpeg',
      category: 'DISPUTE_EVIDENCE',
      uploaderUserId: owner,
      visibility: 'PRIVATE_CASE',
      grantedUserIds: [],
      ...overrides,
    });
    return id;
  };

  describe('attaching', () => {
    it('attaches the buyer’s files under an event, records their role and grants the seller', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const files = [upload(f.buyer), upload(f.buyer)];
      grants.length = 0;
      const result = await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'INSPECTION',
        fileIds: files,
      });
      expect(result.evidence.map((e) => e.fileId)).toEqual(files);
      expect(result.evidence[0]).toMatchObject({ event: 'INSPECTION', attachedByRole: 'BUYER' });
      expect(grants).toEqual([{ fileIds: files, to: f.seller }]);
    });

    it('is a no-op on a replay, and grants again so a failed grant heals', async () => {
      const f = await tradeAt(t, 'SHIPPED');
      const file = upload(f.seller);
      const first = await attachEvidence(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        event: 'DISPATCH',
        fileIds: [file],
      });
      grants.length = 0;
      const again = await attachEvidence(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        event: 'DISPATCH',
        fileIds: [file],
      });
      expect(again.evidence).toEqual(first.evidence);
      expect(grants).toEqual([{ fileIds: [file], to: f.buyer }]);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_evidence_media WHERE file_id = $1`, [file]);
      expect(rows).toHaveLength(1);
    });

    it('treats a stranger as not found', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const stranger = await person(t);
      const error = await failure(
        attachEvidence(deps(), {
          userId: stranger,
          tradeId: f.tradeId,
          event: 'DELIVERY',
          fileIds: [upload(stranger)],
        }),
      );
      expect(error.status).toBe(404);
    });

    it('keeps dispatch to the seller and inspection to the buyer', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const dispatch = await failure(
        attachEvidence(deps(), {
          userId: f.buyer,
          tradeId: f.tradeId,
          event: 'DISPATCH',
          fileIds: [upload(f.buyer)],
        }),
      );
      expect(dispatch.status).toBe(403);
      const inspection = await failure(
        attachEvidence(deps(), {
          userId: f.seller,
          tradeId: f.tradeId,
          event: 'INSPECTION',
          fileIds: [upload(f.seller)],
        }),
      );
      expect(inspection.status).toBe(403);
      // Delivery and issue are either side’s.
      for (const [userId, event] of [
        [f.seller, 'DELIVERY'],
        [f.buyer, 'ISSUE'],
      ] as const) {
        const ok = await attachEvidence(deps(), {
          userId,
          tradeId: f.tradeId,
          event,
          fileIds: [upload(userId)],
        });
        expect(ok.evidence).toHaveLength(1);
      }
    });

    it('refuses a trade that is not shipped or has closed', async () => {
      for (const status of ['FUNDED', 'COMPLETED']) {
        const f = await tradeAt(t, status);
        const error = await failure(
          attachEvidence(deps(), {
            userId: f.seller,
            tradeId: f.tradeId,
            event: 'DELIVERY',
            fileIds: [upload(f.seller)],
          }),
        );
        expect(error.status, status).toBe(409);
        expect(error.extensions).toMatchObject({ reason: 'EVIDENCE_CLOSED' });
      }
    });

    it('refuses files that are not the caller’s own private uploads, unused anywhere', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const other = await tradeAt(t, 'INSPECTION');
      const cases: Record<string, string> = {
        'someone else’s': upload(f.seller),
        public: upload(f.buyer, { visibility: 'PUBLIC' }),
        'already shared': upload(f.buyer, { grantedUserIds: [f.seller] }),
        unknown: randomUUID(),
      };
      for (const [name, file] of Object.entries(cases)) {
        const error = await failure(
          attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [file] }),
        );
        expect(error.status, name).toBe(422);
      }
      // Already evidence on another trade, already seller proof, already a waybill receipt.
      const elsewhere = upload(other.buyer);
      await attachEvidence(deps(), {
        userId: other.buyer,
        tradeId: other.tradeId,
        event: 'DELIVERY',
        fileIds: [elsewhere],
      });
      const proof = upload(f.buyer);
      await insertRow(t.owner(), 'trade.trade_proof_media', {
        trade_id: f.tradeId,
        file_id: proof,
        attached_by_user_id: f.seller,
      });
      for (const file of [elsewhere, proof]) {
        const error = await failure(
          attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [file] }),
        );
        expect(error.status).toBe(422);
      }
    });

    it('says a file still landing is processing, so the client can wait', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const pending = randomUUID();
      progress.set(pending, { uploaderUserId: f.buyer, uploadState: 'RECONCILING', status: 'ACTIVE' });
      const error = await failure(
        attachEvidence(deps(), {
          userId: f.buyer,
          tradeId: f.tradeId,
          event: 'DELIVERY',
          fileIds: [pending],
        }),
      );
      expect(error.status).toBe(409);
      expect(error.extensions).toMatchObject({ reason: 'FILE_PROCESSING' });
      // Someone else's pending upload is not described to this caller.
      const theirs = randomUUID();
      progress.set(theirs, { uploaderUserId: f.seller, uploadState: 'PENDING', status: 'ACTIVE' });
      const other = await failure(
        attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [theirs] }),
      );
      expect(other.status).toBe(422);
    });

    it('caps an event at the limit and attaches nothing that overflows it', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'ISSUE',
        fileIds: Array.from({ length: 10 }, () => upload(f.buyer)),
      });
      await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'ISSUE',
        fileIds: Array.from({ length: MAX_FILES_PER_EVENT - 10 }, () => upload(f.buyer)),
      });
      const over = upload(f.buyer);
      const error = await failure(
        attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'ISSUE', fileIds: [over] }),
      );
      expect(error.status).toBe(422);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_evidence_media WHERE file_id = $1`, [over]);
      expect(rows).toHaveLength(0);
    });
    it('takes only images and PDFs made for evidence: not video, not another job’s category', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const attempts = {
        video: upload(f.buyer, { contentType: 'video/mp4' }),
        ticket: upload(f.buyer, { category: 'TICKET_ATTACHMENT' }),
        chat: upload(f.buyer, { category: 'CHAT_ATTACHMENT' }),
        unknownCategory: upload(f.buyer, { category: undefined }),
      };
      for (const [name, file] of Object.entries(attempts)) {
        const error = await failure(
          attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [file] }),
        );
        expect(error.status, name).toBe(422);
      }
      const pdf = upload(f.buyer, { contentType: 'application/pdf' });
      const dispute = upload(f.buyer, { category: 'DISPUTE_EVIDENCE', contentType: 'image/png' });
      const ok = await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'DELIVERY',
        fileIds: [pdf, dispute],
      });
      expect(ok.evidence).toHaveLength(2);
    });

    it('keeps the cap per party, so one side cannot lock the other out of an event', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'ISSUE',
        fileIds: Array.from({ length: 10 }, () => upload(f.buyer)),
      });
      await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'ISSUE',
        fileIds: Array.from({ length: MAX_FILES_PER_EVENT - 10 }, () => upload(f.buyer)),
      });
      const mine = await attachEvidence(deps(), {
        userId: f.seller,
        tradeId: f.tradeId,
        event: 'ISSUE',
        fileIds: [upload(f.seller)],
      });
      expect(mine.evidence).toHaveLength(1);
    });

    it('commits the evidence and the grant together: a failed grant leaves nothing behind', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const file = upload(f.buyer);
      grantFails.on = true;
      const error = await failure(
        attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [file] }),
      );
      grantFails.on = false;
      expect(error.message).toBe('grant failed');
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM trade.trade_evidence_media WHERE file_id = $1`, [file]);
      expect(rows).toHaveLength(0);
      const retry = await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'DELIVERY',
        fileIds: [file],
      });
      expect(retry.evidence).toHaveLength(1);
    });

    it('answers a replay after the trade has closed, and grants again, but takes nothing new', async () => {
      // Evidence attached while the trade was open (the row as the attach leaves it); the trade has since closed.
      const f = await tradeAt(t, 'COMPLETED');
      const file = upload(f.buyer);
      await insertRow(t.owner(), 'trade.trade_evidence_media', {
        trade_id: f.tradeId,
        file_id: file,
        event: 'DELIVERY',
        attached_by_user_id: f.buyer,
        attached_by_role: 'BUYER',
      });
      grants.length = 0;
      const again = await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'DELIVERY',
        fileIds: [file],
      });
      expect(again.evidence).toHaveLength(1);
      expect(grants).toEqual([{ fileIds: [file], to: f.seller }]);
      const fresh = await failure(
        attachEvidence(deps(), {
          userId: f.buyer,
          tradeId: f.tradeId,
          event: 'DELIVERY',
          fileIds: [upload(f.buyer)],
        }),
      );
      expect(fresh.status).toBe(409);
    });
  });

  describe('reading', () => {
    it('lists both parties’ evidence to both parties, by event, oldest first, in pages', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const a = upload(f.seller);
      const b = upload(f.buyer);
      const c = upload(f.buyer);
      await attachEvidence(deps(), { userId: f.seller, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [a] });
      await attachEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'DELIVERY', fileIds: [b] });
      await attachEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        event: 'INSPECTION',
        fileIds: [c],
      });

      for (const userId of [f.buyer, f.seller]) {
        const all = await listEvidence(deps(), { userId, tradeId: f.tradeId, limit: 50 });
        expect(all.items.map((i) => i.fileId)).toEqual([a, b, c]);
        const delivery = await listEvidence(deps(), {
          userId,
          tradeId: f.tradeId,
          event: 'DELIVERY',
          limit: 50,
        });
        expect(delivery.items.map((i) => [i.fileId, i.attachedByRole])).toEqual([
          [a, 'SELLER'],
          [b, 'BUYER'],
        ]);
      }

      const first = await listEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, limit: 2 });
      expect(first.items.map((i) => i.fileId)).toEqual([a, b]);
      expect(first.nextCursor).not.toBeNull();
      const { decodeCursor } = await import('../../../../src/platform/http/paginate.js');
      const second = await listEvidence(deps(), {
        userId: f.buyer,
        tradeId: f.tradeId,
        limit: 2,
        cursor: decodeCursor(first.nextCursor!),
      });
      expect(second.items.map((i) => i.fileId)).toEqual([c]);
      expect(second.nextCursor).toBeNull();
    });

    it('answers a stranger as not found and a cursor from another trade or filter with 422', async () => {
      const f = await tradeAt(t, 'INSPECTION');
      const g = await tradeAt(t, 'INSPECTION');
      const stranger = await person(t);
      expect(
        (await failure(listEvidence(deps(), { userId: stranger, tradeId: f.tradeId, limit: 5 }))).status,
      ).toBe(404);
      for (const id of [f, g]) {
        await attachEvidence(deps(), {
          userId: id.buyer,
          tradeId: id.tradeId,
          event: 'DELIVERY',
          fileIds: [upload(id.buyer), upload(id.buyer)],
        });
      }
      const page = await listEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, limit: 1 });
      const { decodeCursor } = await import('../../../../src/platform/http/paginate.js');
      const cursor = decodeCursor(page.nextCursor!);
      expect(
        (await failure(listEvidence(deps(), { userId: g.buyer, tradeId: g.tradeId, limit: 1, cursor })))
          .status,
      ).toBe(422);
      expect(
        (
          await failure(
            listEvidence(deps(), { userId: f.buyer, tradeId: f.tradeId, event: 'ISSUE', limit: 1, cursor }),
          )
        ).status,
      ).toBe(422);
    });
  });
});
