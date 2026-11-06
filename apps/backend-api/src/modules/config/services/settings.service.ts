// The write path for M17: every change is one transaction holding the row, the append-only change log,
// the admin action row (identity's audit log, until M14's own exists) and the outbox event. A change
// that cannot be explained afterwards does not happen.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { writeAudit } from '../../identity/index.js';
import { featureFlagToggled, settingChanged } from '../domain/events.js';
import { feeRefused, invalidValue, settingNotFound } from '../domain/errors.js';
import {
  FLAG_CODE_PATTERN,
  SEED_SETTINGS,
  findDefinition,
  looksLikeFee,
  validateSettingValue,
  type SettingValue,
  type ValueType,
} from '../domain/settings.js';
import {
  configChangeLog,
  featureFlags,
  platformSettings,
} from '../infrastructure/postgres/schema/settings.js';
import { ApiError } from '../../../platform/errors.js';

export const AUDIT = {
  SETTING_CHANGED: 'ADMIN_CONFIG_SETTING_CHANGED',
  FLAG_CHANGED: 'ADMIN_CONFIG_FLAG_CHANGED',
} as const;

export interface ConfigActor {
  userId: string;
  sessionId?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
}

export interface SettingView {
  namespace: string;
  key: string;
  value: SettingValue;
  valueType: ValueType;
  description: string;
  updatedAt: Date;
  updatedByAdminId: string | null;
}

export interface FlagView {
  code: string;
  description: string;
  enabled: boolean;
  rolloutNote: string | null;
  updatedAt: Date;
  updatedByAdminId: string | null;
}

export interface ChangeLogView {
  id: number;
  occurredAt: Date;
  changeTarget: string;
  namespaceOrFlagCode: string;
  key: string | null;
  oldValue: unknown;
  newValue: unknown;
  changedByAdminId: string;
  reason: string;
}

/**
 * Inserts every seeded default that is not already there. It never overwrites a row: a setting an
 * operator has changed stays changed across deploys, and the seed runs on every one.
 */
export async function seedSettings(db: Db): Promise<void> {
  for (const setting of SEED_SETTINGS) {
    if (looksLikeFee(setting.namespace, setting.key)) {
      throw new Error(`config: seed ${setting.namespace}.${setting.key} looks like a fee (design 6.5)`);
    }
  }
  await db
    .insert(platformSettings)
    .values(
      SEED_SETTINGS.map((setting) => ({
        namespace: setting.namespace,
        key: setting.key,
        value: setting.value,
        valueType: setting.valueType,
        description: setting.description,
      })),
    )
    .onConflictDoNothing();
}

const toSetting = (row: typeof platformSettings.$inferSelect): SettingView => ({
  namespace: row.namespace,
  key: row.key,
  value: row.value as SettingValue,
  valueType: row.valueType as ValueType,
  description: row.description,
  updatedAt: row.updatedAt,
  updatedByAdminId: row.updatedByAdminId,
});

export async function listSettings(
  db: Db,
  namespace: string,
  { page, limit }: Pagination,
): Promise<{ items: SettingView[]; page: number; limit: number; total: number }> {
  const where = eq(platformSettings.namespace, namespace);
  const rows = await db
    .select()
    .from(platformSettings)
    .where(where)
    .orderBy(asc(platformSettings.key))
    .limit(limit)
    .offset((page - 1) * limit);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(platformSettings)
    .where(where);
  return { items: rows.map(toSetting), page, limit, total: count?.n ?? 0 };
}

const auditFields = (actor: ConfigActor) => ({
  actorType: 'STAFF' as const,
  actorUserId: actor.userId,
  sessionId: actor.sessionId ?? null,
  ip: actor.ip ?? null,
  userAgent: actor.userAgent ?? null,
});

export interface ChangeSettingInput {
  actor: ConfigActor;
  namespace: string;
  key: string;
  value: unknown;
  reason: string;
}

/**
 * Changes an existing setting. A key that is not already in the table is a 404 rather than an insert:
 * new settings arrive with the code that reads them, through the seed, so a typo in a URL cannot
 * create a setting nothing will ever read.
 *
 * Returns the stored view; `changed` is false when the value was already that, in which case nothing
 * is logged and nothing is published.
 */
export async function changeSetting(
  db: Db,
  input: ChangeSettingInput,
): Promise<{ setting: SettingView; changed: boolean }> {
  if (looksLikeFee(input.namespace, input.key)) throw feeRefused(`${input.namespace}.${input.key}`);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(platformSettings)
      .where(and(eq(platformSettings.namespace, input.namespace), eq(platformSettings.key, input.key)))
      .for('update');
    if (!current) throw settingNotFound(input.namespace, input.key);

    const checked = validateSettingValue(
      { valueType: current.valueType as ValueType, ...boundsOf(input.namespace, input.key) },
      input.value,
    );
    if (!checked.ok) throw invalidValue(checked.message);
    if (JSON.stringify(current.value) === JSON.stringify(checked.value)) {
      return { setting: toSetting(current), changed: false };
    }

    const [updated] = await tx
      .update(platformSettings)
      .set({ value: checked.value, updatedAt: new Date(), updatedByAdminId: input.actor.userId })
      .where(and(eq(platformSettings.namespace, input.namespace), eq(platformSettings.key, input.key)))
      .returning();
    if (!updated) throw new Error('config: the update returned no row');

    await tx.insert(configChangeLog).values({
      changeTarget: 'SETTING',
      namespaceOrFlagCode: input.namespace,
      key: input.key,
      oldValue: current.value,
      newValue: checked.value,
      changedByAdminId: input.actor.userId,
      reason: input.reason,
    });
    await writeAudit(tx, {
      ...auditFields(input.actor),
      action: AUDIT.SETTING_CHANGED,
      outcome: 'SUCCESS',
      metadata: {
        namespace: input.namespace,
        key: input.key,
        oldValue: current.value,
        newValue: checked.value,
        reason: input.reason,
      },
    });
    await publish(tx, settingChanged, {
      payload: {
        namespace: input.namespace,
        key: input.key,
        oldValue: current.value as SettingValue,
        newValue: checked.value,
      },
      aggregateType: 'config.setting',
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    return { setting: toSetting(updated), changed: true };
  });
}

const boundsOf = (namespace: string, key: string): { min?: number; max?: number; maxScale?: number } => {
  const definition = findDefinition(namespace, key);
  return {
    ...(definition?.min !== undefined ? { min: definition.min } : {}),
    ...(definition?.max !== undefined ? { max: definition.max } : {}),
    ...(definition?.maxScale !== undefined ? { maxScale: definition.maxScale } : {}),
  };
};

const toFlag = (row: typeof featureFlags.$inferSelect): FlagView => ({
  code: row.code,
  description: row.description,
  enabled: row.enabled,
  rolloutNote: row.rolloutNote,
  updatedAt: row.updatedAt,
  updatedByAdminId: row.updatedByAdminId,
});

export async function listFlags(
  db: Db,
  { page, limit }: Pagination,
): Promise<{ items: FlagView[]; page: number; limit: number; total: number }> {
  const rows = await db
    .select()
    .from(featureFlags)
    .orderBy(asc(featureFlags.code))
    .limit(limit)
    .offset((page - 1) * limit);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(featureFlags);
  return { items: rows.map(toFlag), page, limit, total: count?.n ?? 0 };
}

export interface ChangeFlagInput {
  actor: ConfigActor;
  code: string;
  enabled: boolean;
  rolloutNote?: string | null | undefined;
  /** Required when the flag does not exist yet, ignored otherwise. */
  description?: string | undefined;
  reason: string;
}

/**
 * Creates or toggles a flag. A new flag starts from an explicit `enabled` and a description, because
 * a switch nobody can explain is the one nobody dares remove.
 */
export async function changeFlag(
  db: Db,
  input: ChangeFlagInput,
): Promise<{ flag: FlagView; changed: boolean }> {
  if (!FLAG_CODE_PATTERN.test(input.code)) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid flag code',
      'Use lower-case words joined by _ or .',
    );
  }
  if (looksLikeFee(input.code)) throw feeRefused(input.code);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.code, input.code))
      .for('update');
    if (!current && !input.description) {
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        'A new flag needs a description',
        'State what the flag switches on',
        [{ path: 'description', message: 'Required to create a flag' }],
      );
    }
    const note = input.rolloutNote === undefined ? (current?.rolloutNote ?? null) : input.rolloutNote;
    if (current && current.enabled === input.enabled && current.rolloutNote === note) {
      return { flag: toFlag(current), changed: false };
    }

    const values = {
      code: input.code,
      description: current?.description ?? input.description ?? '',
      enabled: input.enabled,
      rolloutNote: note,
      updatedAt: new Date(),
      updatedByAdminId: input.actor.userId,
    };
    const [written] = current
      ? await tx.update(featureFlags).set(values).where(eq(featureFlags.code, input.code)).returning()
      : await tx.insert(featureFlags).values(values).returning();
    if (!written) throw new Error('config: the flag write returned no row');

    await tx.insert(configChangeLog).values({
      changeTarget: 'FLAG',
      namespaceOrFlagCode: input.code,
      key: null,
      oldValue: current ? { enabled: current.enabled, rolloutNote: current.rolloutNote } : null,
      newValue: { enabled: written.enabled, rolloutNote: written.rolloutNote },
      changedByAdminId: input.actor.userId,
      reason: input.reason,
    });
    await writeAudit(tx, {
      ...auditFields(input.actor),
      action: AUDIT.FLAG_CHANGED,
      outcome: 'SUCCESS',
      metadata: {
        code: input.code,
        created: !current,
        wasEnabled: current?.enabled ?? null,
        enabled: written.enabled,
        reason: input.reason,
      },
    });
    await publishFlag(tx, input, written.enabled);
    return { flag: toFlag(written), changed: true };
  });
}

async function publishFlag(tx: Tx, input: ChangeFlagInput, enabled: boolean): Promise<void> {
  await publish(tx, featureFlagToggled, {
    payload: { flagCode: input.code, enabled },
    aggregateType: 'config.flag',
    actor: { type: 'STAFF', id: input.actor.userId },
  });
}

export async function listChangeLog(
  db: Db,
  input: Pagination & { target?: 'SETTING' | 'FLAG' | undefined; subject?: string | undefined },
): Promise<{ items: ChangeLogView[]; page: number; limit: number; total: number }> {
  const filters = [
    input.target ? eq(configChangeLog.changeTarget, input.target) : undefined,
    input.subject ? eq(configChangeLog.namespaceOrFlagCode, input.subject) : undefined,
  ].filter((f) => f !== undefined);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select()
    .from(configChangeLog)
    .where(where)
    .orderBy(desc(configChangeLog.occurredAt), desc(configChangeLog.id))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(configChangeLog)
    .where(where);
  return { items: rows, page: input.page, limit: input.limit, total: count?.n ?? 0 };
}
