// F-028 (CWT-S13): attach an uploaded file to a trade under an event, and read a trade's evidence back.
//
// The owner's flow is upload first (`/files/upload-url`, then `/files/:id/finalize`), then attach by id, so this never
// sees bytes. The party door is `loadTrade` + `requireParty`, the same one every other trade route goes through, so a
// stranger, a missing trade and a trade the counterparty may not see yet all answer 404.
import type { FileCategory } from '@komtru/shared-types';
import type { Paginated } from '@komtru/shared-types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CursorKey } from '../../../platform/http/paginate.js';
import { cursorPage } from '../../../platform/http/paginate.js';
import {
  EVIDENCE_CONTENT_TYPES,
  EVIDENCE_FILE_CATEGORIES,
  EVIDENCE_OPEN_STATUSES,
  evidenceClosedError,
  evidenceCursor,
  fileProcessingError,
  MAX_FILES_PER_EVENT,
  mayAttach,
  readEvidenceCursor,
  tooManyEvidenceError,
  unusableFilesError,
  wrongRoleError,
  type TradeEvidenceEvent,
} from '../domain/evidence.js';
import { selfArrangedShipments } from '../infrastructure/postgres/schema/fulfilment.js';
import { tradeEvidenceMedia, tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import type { EvidenceDeps } from './evidencePorts.js';
import { loadTrade, recordActivity, requireParty } from './trade.service.js';

export interface EvidenceItem {
  id: string;
  fileId: string;
  event: TradeEvidenceEvent;
  attachedByRole: 'BUYER' | 'SELLER';
  attachedAt: string;
}

type Row = typeof tradeEvidenceMedia.$inferSelect;

const view = (row: Row): EvidenceItem => ({
  id: row.id,
  fileId: row.fileId,
  event: row.event,
  attachedByRole: row.attachedByRole,
  attachedAt: row.createdAt.toISOString(),
});

/**
 * Attaches finished uploads as evidence. A replay by the same party with the same files and event returns the same
 * rows, and runs the grant again so one that failed after commit heals.
 */
export async function attachEvidence(
  deps: EvidenceDeps,
  input: { userId: string; tradeId: string; event: TradeEvidenceEvent; fileIds: readonly string[] },
): Promise<{ evidence: EvidenceItem[] }> {
  const unique = [...new Set(input.fileIds)];
  const done = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    const role = requireParty(trade, input.userId);
    if (!mayAttach(role, input.event)) throw wrongRoleError(input.event);

    const existing = await tx
      .select()
      .from(tradeEvidenceMedia)
      .where(inArray(tradeEvidenceMedia.fileId, unique));
    const mine = new Map(
      existing
        .filter(
          (row) =>
            row.tradeId === trade.id && row.event === input.event && row.attachedByUserId === input.userId,
        )
        .map((row) => [row.fileId, row]),
    );
    const fresh = unique.filter((id) => !mine.has(id));
    // A replay of what is already attached is answered (and its grant made) even after the trade has closed.
    if (fresh.length > 0 && !EVIDENCE_OPEN_STATUSES.includes(trade.status)) throw evidenceClosedError();
    // A file already evidence somewhere else, or on this trade under another event or by the other party, is no good.
    const taken = new Set(existing.map((row) => row.fileId).filter((id) => !mine.has(id)));

    if (fresh.length > 0) {
      const found = await deps.proofFiles(tx, fresh);
      const usable = new Set(
        found
          .filter(
            (file) =>
              file.uploaderUserId === input.userId &&
              file.visibility === 'PRIVATE_CASE' &&
              file.category !== undefined &&
              EVIDENCE_FILE_CATEGORIES.includes(file.category as FileCategory) &&
              EVIDENCE_CONTENT_TYPES.includes(file.contentType.toLowerCase()) &&
              file.grantedUserIds.length === 0 &&
              !taken.has(file.id),
          )
          .map((file) => file.id),
      );
      const missing = fresh.filter((id) => !usable.has(id));
      if (missing.length > 0) {
        // Still landing is the caller's to wait out; only their own uploads are described as such.
        const progress = await deps.fileProgress(tx, missing);
        const landing = missing.some((id) => {
          const file = progress.get(id);
          return (
            file !== undefined &&
            file.uploaderUserId === input.userId &&
            file.status === 'ACTIVE' &&
            (file.uploadState === 'PENDING' || file.uploadState === 'RECONCILING') &&
            !taken.has(id)
          );
        });
        if (landing) throw fileProcessingError();
        throw unusableFilesError(missing);
      }
      // Already the seller's proof or a waybill receipt (on any trade): one file, one job.
      const [asProof, asReceipt] = await Promise.all([
        tx
          .select({ fileId: tradeProofMedia.fileId })
          .from(tradeProofMedia)
          .where(inArray(tradeProofMedia.fileId, fresh)),
        tx
          .select({ fileId: selfArrangedShipments.receiptFileId })
          .from(selfArrangedShipments)
          .where(inArray(selfArrangedShipments.receiptFileId, fresh)),
      ]);
      const used = new Set([...asProof.map((r) => r.fileId), ...asReceipt.map((r) => r.fileId)]);
      const reused = fresh.filter((id) => used.has(id));
      if (reused.length > 0) throw unusableFilesError(reused);

      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tradeEvidenceMedia)
        .where(
          and(
            eq(tradeEvidenceMedia.tradeId, trade.id),
            eq(tradeEvidenceMedia.event, input.event),
            eq(tradeEvidenceMedia.attachedByUserId, input.userId),
          ),
        );
      if (count + fresh.length > MAX_FILES_PER_EVENT) throw tooManyEvidenceError(input.event);

      const inserted = await tx
        .insert(tradeEvidenceMedia)
        .values(
          fresh.map((fileId) => ({
            tradeId: trade.id,
            fileId,
            event: input.event,
            attachedByUserId: input.userId,
            attachedByRole: role,
          })),
        )
        .onConflictDoNothing()
        .returning();
      // A concurrent attach of the same file lost the race on the unique index.
      if (inserted.length !== fresh.length) {
        const won = new Set(inserted.map((row) => row.fileId));
        throw unusableFilesError(fresh.filter((id) => !won.has(id)));
      }
      for (const row of inserted) mine.set(row.fileId, row);
      await recordActivity(tx, {
        tradeId: trade.id,
        type: 'NOTE',
        actorType: role,
        actorId: input.userId,
        metadata: { event: 'EVIDENCE_ADDED', evidenceEvent: input.event, files: fresh.length },
      });
    }

    // In the same transaction as the rows: evidence the other side cannot open is never left behind. Re-run on a
    // replay, which is how an earlier grant that was lost heals.
    const counterparty = role === 'BUYER' ? trade.sellerUserId : trade.buyerUserId;
    const rows = unique.flatMap((id) => {
      const row = mine.get(id);
      return row ? [row] : [];
    });
    if (counterparty) {
      await deps.grantEvidenceAccess(
        tx,
        rows.map((row) => row.fileId),
        counterparty,
        trade.tradeCode,
      );
    }
    return rows;
  });

  return { evidence: done.map(view) };
}

const MICRO = sql.raw(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The media the parties added, oldest first (the order it was taken in), optionally for one event. */
export async function listEvidence(
  deps: Pick<EvidenceDeps, 'db'>,
  input: {
    userId: string;
    tradeId: string;
    event?: TradeEvidenceEvent | undefined;
    limit: number;
    cursor?: CursorKey | undefined;
  },
): Promise<Paginated<EvidenceItem>> {
  const after = readEvidenceCursor(input.cursor, input.tradeId, input.event);
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    requireParty(trade, input.userId);
    const result = await tx.execute<{
      id: string;
      file_id: string;
      event: TradeEvidenceEvent;
      attached_by_role: 'BUYER' | 'SELLER';
      cursor_ts: string;
    }>(sql`
      SELECT id, file_id, event, attached_by_role, ${MICRO} AS cursor_ts
      FROM ${tradeEvidenceMedia}
      WHERE trade_id = ${trade.id}
        ${input.event ? sql`AND event = ${input.event}` : sql``}
        ${after ? sql`AND (created_at, id) > (${after.ts}::timestamptz, ${after.id}::uuid)` : sql``}
      ORDER BY created_at ASC, id ASC
      LIMIT ${input.limit + 1}
    `);
    const rows = result.rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      event: row.event,
      attachedByRole: row.attached_by_role,
      attachedAt: row.cursor_ts,
      cursorTs: row.cursor_ts,
    }));
    const page = cursorPage(rows, input.limit, (row) => evidenceCursor(row, trade.id, input.event));
    return {
      items: page.items.map(({ cursorTs: _ts, ...item }) => item),
      nextCursor: page.nextCursor,
    };
  });
}
