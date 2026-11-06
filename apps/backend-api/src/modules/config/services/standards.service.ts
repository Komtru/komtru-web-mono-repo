// T-049 write and read paths. Publishing a standard is one transaction holding the new version row (which
// is also the change record: reason, author, time), the admin action row and the outbox event. The
// category row is locked first, so two publishes serialise and take consecutive version numbers.
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish } from '../../../platform/events/publish.js';
import { writeAudit } from '../../identity/index.js';
import { tradeStandardChanged } from '../domain/events.js';
import { SEED_CATEGORIES, resolveWindowExtension, type StandardContent } from '../domain/standards.js';
import { tradeCategories, tradeStandards } from '../infrastructure/postgres/schema/standards.js';
import type { ConfigAccessor } from './accessor.js';
import type { ConfigActor } from './settings.service.js';

export const STANDARD_AUDIT = 'ADMIN_CONFIG_TRADE_STANDARD_CHANGED';
export const MAX_EXTENSION_SETTING = { namespace: 'trades', key: 'inspection_window_max_extension_hours' };

/** What the public sees: the standard itself, never who changed it or why. */
export interface StandardView extends StandardContent {
  versionId: string;
  categoryCode: string;
  categoryName: string;
  versionNumber: number;
  createdAt: Date;
}

export interface AdminStandardView extends StandardView {
  reason: string;
  changedByAdminId: string | null;
}

type Row = { category: typeof tradeCategories.$inferSelect; standard: typeof tradeStandards.$inferSelect };

const toAdminView = ({ category, standard }: Row): AdminStandardView => ({
  versionId: standard.id,
  categoryCode: category.code,
  categoryName: category.name,
  versionNumber: standard.versionNumber,
  createdAt: standard.createdAt,
  inspectionWindowHours: standard.inspectionWindowHours,
  itemSpecFields: standard.itemSpecFields as StandardContent['itemSpecFields'],
  proofMedia: standard.proofMedia as StandardContent['proofMedia'],
  imeiVerification: standard.imeiVerification,
  deliveryDeadlineDays: standard.deliveryDeadlineDays,
  reason: standard.reason,
  changedByAdminId: standard.changedByAdminId,
});

export const toPublicView = ({
  reason: _reason,
  changedByAdminId: _admin,
  ...rest
}: AdminStandardView): StandardView => rest;

const categoryNotFound = (code: string) =>
  new ApiError(404, 'NOT_FOUND', 'No such trade category', `${code} is not a trade category`);
const versionNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such trade standard version');

const contentOf = (s: StandardContent): StandardContent => ({
  inspectionWindowHours: s.inspectionWindowHours,
  itemSpecFields: s.itemSpecFields.map(({ key, label, required }) => ({ key, label, required })),
  proofMedia: { minPhotos: s.proofMedia.minPhotos, requireVideo: s.proofMedia.requireVideo },
  imeiVerification: s.imeiVerification,
  deliveryDeadlineDays: s.deliveryDeadlineDays,
});

/** Insert-only: a category that already has a version is left exactly as an operator last set it. */
export async function seedStandards(db: Db): Promise<void> {
  for (const seed of SEED_CATEGORIES) {
    await db.transaction(async (tx) => {
      await tx.insert(tradeCategories).values({ code: seed.code, name: seed.name }).onConflictDoNothing();
      const [category] = await tx
        .select()
        .from(tradeCategories)
        .where(eq(tradeCategories.code, seed.code))
        .for('update');
      if (!category) throw new Error(`config: category ${seed.code} vanished during the seed`);
      const [existing] = await tx
        .select({ id: tradeStandards.id })
        .from(tradeStandards)
        .where(eq(tradeStandards.categoryId, category.id))
        .limit(1);
      if (existing) return;
      await tx.insert(tradeStandards).values({
        categoryId: category.id,
        versionNumber: 1,
        ...seed.standard,
        reason: 'Launch default',
      });
    });
  }
}

const currentRows = (db: Db) =>
  db
    .selectDistinctOn([tradeStandards.categoryId])
    .from(tradeStandards)
    .innerJoin(tradeCategories, eq(tradeCategories.id, tradeStandards.categoryId))
    .orderBy(tradeStandards.categoryId, desc(tradeStandards.versionNumber));

/** The current standard of every active category, by category code. */
export async function listCurrentStandards(db: Db): Promise<AdminStandardView[]> {
  const rows = await currentRows(db);
  return rows
    .filter((r) => r.trade_categories.active)
    .map((r) => toAdminView({ category: r.trade_categories, standard: r.trade_standards }))
    .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode));
}

export async function getCurrentStandard(db: Db, categoryCode: string): Promise<AdminStandardView> {
  const [row] = await db
    .select()
    .from(tradeStandards)
    .innerJoin(tradeCategories, eq(tradeCategories.id, tradeStandards.categoryId))
    .where(eq(tradeCategories.code, categoryCode))
    .orderBy(desc(tradeStandards.versionNumber))
    .limit(1);
  if (!row || !row.trade_categories.active) throw categoryNotFound(categoryCode);
  return toAdminView({ category: row.trade_categories, standard: row.trade_standards });
}

/** For a trade that snapshotted a version id: exactly the standard it was created under. */
export async function getStandardVersion(db: Db, versionId: string): Promise<AdminStandardView> {
  const [row] = await db
    .select()
    .from(tradeStandards)
    .innerJoin(tradeCategories, eq(tradeCategories.id, tradeStandards.categoryId))
    .where(eq(tradeStandards.id, versionId))
    .limit(1);
  if (!row) throw versionNotFound();
  return toAdminView({ category: row.trade_categories, standard: row.trade_standards });
}

export async function publishStandard(
  db: Db,
  input: { actor: ConfigActor; categoryCode: string; content: StandardContent; reason: string },
): Promise<{ standard: AdminStandardView; changed: boolean }> {
  const content = contentOf(input.content);
  return db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(tradeCategories)
      .where(eq(tradeCategories.code, input.categoryCode))
      .for('update');
    if (!category || !category.active) throw categoryNotFound(input.categoryCode);

    const [latest] = await tx
      .select()
      .from(tradeStandards)
      .where(eq(tradeStandards.categoryId, category.id))
      .orderBy(desc(tradeStandards.versionNumber))
      .limit(1);
    if (latest) {
      const before = toAdminView({ category, standard: latest });
      if (JSON.stringify(contentOf(before)) === JSON.stringify(content)) {
        return { standard: before, changed: false };
      }
    }

    const [created] = await tx
      .insert(tradeStandards)
      .values({
        categoryId: category.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        ...content,
        changedByAdminId: input.actor.userId,
        reason: input.reason,
      })
      .returning();
    if (!created) throw new Error('config: the standard insert returned no row');

    await writeAudit(tx, {
      actorType: 'STAFF',
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId ?? null,
      ip: input.actor.ip ?? null,
      userAgent: input.actor.userAgent ?? null,
      action: STANDARD_AUDIT,
      outcome: 'SUCCESS',
      metadata: {
        categoryCode: category.code,
        versionId: created.id,
        versionNumber: created.versionNumber,
        previousVersionNumber: latest?.versionNumber ?? null,
        reason: input.reason,
      },
    });
    await publish(tx, tradeStandardChanged, {
      payload: {
        categoryCode: category.code,
        versionId: created.id,
        versionNumber: created.versionNumber,
      },
      aggregateType: 'config.trade_standard',
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    return { standard: toAdminView({ category, standard: created }), changed: true };
  });
}

/**
 * BEI1 for trade creation and the buyer's request: returns the hours to store, or throws a 422. The
 * standard is the one the trade snapshotted; the cap is the live `trades` setting.
 */
export async function checkBuyerWindowChange(
  db: Db,
  accessor: ConfigAccessor,
  input: { standardVersionId: string; currentHours: number; requestedHours: number },
): Promise<number> {
  const standard = await getStandardVersion(db, input.standardVersionId);
  const maxExtensionHours = await accessor.getInteger(
    MAX_EXTENSION_SETTING.namespace,
    MAX_EXTENSION_SETTING.key,
  );
  const result = resolveWindowExtension({
    standardHours: standard.inspectionWindowHours,
    currentHours: input.currentHours,
    requestedHours: input.requestedHours,
    maxExtensionHours,
  });
  if (!result.ok) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'The inspection window cannot be changed this way',
      result.message,
      [{ path: 'requestedHours', message: result.message }],
    );
  }
  return result.hours;
}
