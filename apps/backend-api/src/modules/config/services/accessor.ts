// The typed read side: what every other module calls to learn a window, a limit or a switch.
//
// Redis is a cache in front of Postgres, never a source. A read that finds the key in Redis returns
// it; one that does not reads Postgres and fills the key for `ttlSeconds`. The key is deleted after a
// change commits and again when `config.setting_changed` is handled (so another instance's write is
// covered), and a Redis outage costs a query and nothing else: every cache call swallows its error.
//
// The TTL is the bound on the one race this cannot close: a reader that fetched the old value just
// before a commit can write it back just after the delete. It will be wrong for at most that long.
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import { SettingMissingError, SettingTypeError } from '../domain/errors.js';
import type { SettingValue, ValueType } from '../domain/settings.js';
import { featureFlags, platformSettings } from '../infrastructure/postgres/schema/settings.js';

export const DEFAULT_CACHE_TTL_SECONDS = 60;

const settingKey = (namespace: string, key: string) => `config:setting:${namespace}.${key}`;
const flagKey = (code: string) => `config:flag:${code}`;

interface Stored {
  value: SettingValue;
  valueType: ValueType;
}

export interface ConfigAccessor {
  getInteger(namespace: string, key: string): Promise<number>;
  getBoolean(namespace: string, key: string): Promise<boolean>;
  getString(namespace: string, key: string): Promise<string>;
  /** A decimal comes back as the string it is stored as, so no float ever rounds it. */
  getDecimal(namespace: string, key: string): Promise<string>;
  /** An unknown flag is off: a capability nobody has switched on is not available. */
  isEnabled(code: string): Promise<boolean>;
  /** Best-effort, for the request path: the TTL bounds a miss. Never throws. */
  invalidateSetting(namespace: string, key: string): Promise<void>;
  invalidateFlag(code: string): Promise<void>;
  /**
   * For the event subscribers: the same delete, but a Redis failure is thrown so the outbox
   * redelivers the event. Deleting an absent key is fine, so delivering twice is too.
   */
  purgeSetting(namespace: string, key: string): Promise<void>;
  purgeFlag(code: string): Promise<void>;
}

export function createConfigAccessor(
  db: Db,
  redis: Redis,
  logger: Logger,
  ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): ConfigAccessor {
  const cacheRead = async (key: string): Promise<string | null> => {
    try {
      return await redis.get(key);
    } catch (error) {
      logger.warn({ err: error }, 'config: could not read the cache');
      return null;
    }
  };
  const cacheWrite = async (key: string, value: string): Promise<void> => {
    try {
      await redis.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      logger.warn({ err: error }, 'config: could not fill the cache');
    }
  };
  const cacheDelete = async (key: string): Promise<void> => {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn({ err: error }, 'config: could not invalidate the cache');
    }
  };

  const load = async (namespace: string, key: string): Promise<Stored> => {
    const cached = await cacheRead(settingKey(namespace, key));
    if (cached !== null) {
      try {
        return JSON.parse(cached) as Stored;
      } catch {
        // A mangled entry is a miss.
      }
    }
    const [row] = await db
      .select({ value: platformSettings.value, valueType: platformSettings.valueType })
      .from(platformSettings)
      .where(and(eq(platformSettings.namespace, namespace), eq(platformSettings.key, key)));
    if (!row) throw new SettingMissingError(namespace, key);
    const stored: Stored = { value: row.value as SettingValue, valueType: row.valueType as ValueType };
    await cacheWrite(settingKey(namespace, key), JSON.stringify(stored));
    return stored;
  };

  const typed = async <T extends SettingValue>(
    namespace: string,
    key: string,
    valueType: ValueType,
    guard: (value: unknown) => value is T,
  ): Promise<T> => {
    const stored = await load(namespace, key);
    if (stored.valueType !== valueType || !guard(stored.value)) {
      throw new SettingTypeError(namespace, key, valueType, stored.valueType);
    }
    return stored.value;
  };

  return {
    getInteger: (namespace, key) =>
      typed(namespace, key, 'INTEGER', (value): value is number => Number.isSafeInteger(value)),
    getBoolean: (namespace, key) =>
      typed(namespace, key, 'BOOLEAN', (value): value is boolean => typeof value === 'boolean'),
    getString: (namespace, key) =>
      typed(namespace, key, 'STRING', (value): value is string => typeof value === 'string'),
    getDecimal: (namespace, key) =>
      typed(namespace, key, 'DECIMAL', (value): value is string => typeof value === 'string'),

    isEnabled: async (code) => {
      const cached = await cacheRead(flagKey(code));
      if (cached === '1' || cached === '0') return cached === '1';
      const [row] = await db
        .select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(eq(featureFlags.code, code));
      const enabled = row?.enabled ?? false;
      await cacheWrite(flagKey(code), enabled ? '1' : '0');
      return enabled;
    },

    invalidateSetting: (namespace, key) => cacheDelete(settingKey(namespace, key)),
    invalidateFlag: (code) => cacheDelete(flagKey(code)),
    purgeSetting: async (namespace, key) => {
      await redis.del(settingKey(namespace, key));
    },
    purgeFlag: async (code) => {
      await redis.del(flagKey(code));
    },
  };
}
