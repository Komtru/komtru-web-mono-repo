// `identity.devices`, as much of it as a sign-in needs.
//
// A fingerprint is a SIGNAL and never an authenticator (§S15): it is spoofable, and nothing here
// grants access on it. What it buys is the "new sign-in" notification §S11 asks for, and a key the
// rate limiter can count an attacker's handset on across the identifiers they are walking.
//
// T-036 absorbed the rest of the registry — trust, retirement, push tokens — as T-032 asked.
//
// Every function below scopes its predicate by `user_id` as well as by `id`, so another user's
// device id is a MISS and never a 403: a 403 would confirm the row exists, which is a (small but
// free to close) cross-account oracle on a value the client controls.
import { and, desc, eq, sql } from 'drizzle-orm';
import { sha256 } from '../../../platform/crypto/hmac.js';
import type { Paged } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import { devices } from '../infrastructure/postgres/schema/sessions.js';

export interface UpsertDeviceInput {
  userId: string;
  fingerprint?: string | null;
  platform?: string | null;
  ip?: string | null;
}

export interface UpsertedDevice {
  deviceId: string | null;
  /** True the first time this account sees this fingerprint. Drives §S11's notification. */
  isNewDevice: boolean;
}

/**
 * A client that sends no fingerprint gets no device row and `isNewDevice: false`.
 *
 * Not `true`: "we have never seen this device" would be literally accurate and would mean the web
 * client, which has no fingerprint at all, emails the user a new-device warning on every single
 * sign-in. A warning that fires every time is a warning nobody reads.
 */
export async function upsertDevice(tx: Tx, input: UpsertDeviceInput): Promise<UpsertedDevice> {
  const fingerprint = input.fingerprint?.trim();
  if (!fingerprint) return { deviceId: null, isNewDevice: false };

  const existing = (
    await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, input.userId), eq(devices.deviceFingerprint, fingerprint)))
      .limit(1)
  )[0];

  if (existing) {
    await tx
      .update(devices)
      .set({ lastSeenAt: sql`now()`, lastSeenIp: input.ip ?? null })
      .where(eq(devices.id, existing.id));
    return { deviceId: existing.id, isNewDevice: false };
  }

  const row = (
    await tx
      .insert(devices)
      .values({
        userId: input.userId,
        deviceFingerprint: fingerprint,
        // NOT NULL in the schema, and a client that does not say is not a reason to refuse a login.
        platform: input.platform ?? 'unknown',
        lastSeenIp: input.ip ?? null,
      })
      // Two sign-ins racing on one new device: whoever loses reads the winner's row rather than
      // failing the login on `devices_user_fingerprint`.
      .onConflictDoNothing({ target: [devices.userId, devices.deviceFingerprint] })
      .returning({ id: devices.id })
  )[0];

  if (row) return { deviceId: row.id, isNewDevice: true };

  const raced = (
    await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, input.userId), eq(devices.deviceFingerprint, fingerprint)))
      .limit(1)
  )[0];
  return { deviceId: raced?.id ?? null, isNewDevice: false };
}

/** The copy `identity.device.signed_in` renders as `{{deviceLabel}}`. */
export const deviceLabel = (userAgent: string | null): string => {
  if (!userAgent) return 'an unrecognised device';
  // Deliberately coarse. A full UA string in a security email is noise to the person reading it,
  // and this is the one place the user is being asked "was this you?".
  const platform = /android/i.test(userAgent)
    ? 'Android'
    : /iphone|ipad|ios/i.test(userAgent)
      ? 'iOS'
      : /windows/i.test(userAgent)
        ? 'Windows'
        : /mac os|macintosh/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : null;
  const browser = /edg\//i.test(userAgent)
    ? 'Edge'
    : /chrome|crios/i.test(userAgent)
      ? 'Chrome'
      : /firefox|fxios/i.test(userAgent)
        ? 'Firefox'
        : /safari/i.test(userAgent)
          ? 'Safari'
          : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? 'an unrecognised device';
};

/**
 * What `{{location}}` renders as. There is no geo-IP in this build, and inventing a city name the
 * system cannot actually produce would be worse than saying so: the IP is at least something the
 * user can take to support.
 */
export const signInLocation = (ip: string | null): string => ip ?? 'an unrecognised location';

// ---------------------------------------------------------------------------
// The rest of §10.5's device registry (T-036).
// ---------------------------------------------------------------------------

/** M1 §5.8's `platform`. A client that does not say gets `unknown` rather than a refused request. */
export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB', 'unknown'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface RegisterDeviceInput {
  userId: string;
  fingerprint: string;
  platform?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  model?: string | null;
  pushToken?: string | null;
  ip?: string | null;
}

export interface DeviceView {
  id: string;
  /**
   * The last six characters of the fingerprint, never the fingerprint.
   *
   * The user needs to tell two handsets apart in a list; §S12 forbids keeping the raw signal
   * anywhere it can travel, and a fingerprint handed back in full is a value an attacker who reads
   * one response can replay into `deviceFrom` to share another device's rate-limit budget.
   */
  fingerprintHint: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  model: string | null;
  status: string;
  trustedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Whether M11 can push to it. The token itself never leaves the database. */
  hasPushToken: boolean;
}

/** Six characters of an opaque string is not enough to replay and is enough to tell two apart. */
export const fingerprintHint = (fingerprint: string): string => fingerprint.slice(-6);

/** What the outbox may carry: Risk groups on it, and §S12 forbids the raw value in a kept row. */
export const fingerprintDigest = (fingerprint: string): string => sha256(fingerprint).toString('hex');

const deviceColumns = {
  id: devices.id,
  deviceFingerprint: devices.deviceFingerprint,
  platform: devices.platform,
  osVersion: devices.osVersion,
  appVersion: devices.appVersion,
  model: devices.model,
  pushToken: devices.pushToken,
  status: devices.status,
  trustedAt: devices.trustedAt,
  firstSeenAt: devices.firstSeenAt,
  lastSeenAt: devices.lastSeenAt,
};

interface DeviceColumns {
  id: string;
  deviceFingerprint: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  model: string | null;
  pushToken: string | null;
  status: string;
  trustedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const toView = (row: DeviceColumns): DeviceView => ({
  id: row.id,
  fingerprintHint: fingerprintHint(row.deviceFingerprint),
  platform: row.platform,
  osVersion: row.osVersion,
  appVersion: row.appVersion,
  model: row.model,
  status: row.status,
  trustedAt: row.trustedAt,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
  hasPushToken: row.pushToken !== null && row.pushToken.length > 0,
});

export interface RegisteredDevice {
  device: DeviceView;
  isNewDevice: boolean;
}

/**
 * The app announcing itself at launch: the fingerprint, what it is running on, and where M11 may
 * push to it.
 *
 * One statement. `onConflictDoUpdate` on `devices_user_fingerprint` is what makes a relaunch an
 * update rather than a 23505, and `COALESCE(excluded, devices)` on each optional column is what
 * stops a client that sends only a push token from blanking the model it told us last week.
 */
export async function registerDevice(tx: Tx, input: RegisterDeviceInput): Promise<RegisteredDevice> {
  const fingerprint = input.fingerprint.trim();
  if (!fingerprint) throw new Error('registerDevice: the fingerprint is empty');

  const existing = (
    await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, input.userId), eq(devices.deviceFingerprint, fingerprint)))
  )[0];

  const row = (
    await tx
      .insert(devices)
      .values({
        userId: input.userId,
        deviceFingerprint: fingerprint,
        platform: input.platform ?? 'unknown',
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
        model: input.model ?? null,
        pushToken: input.pushToken ?? null,
        lastSeenIp: input.ip ?? null,
      })
      .onConflictDoUpdate({
        target: [devices.userId, devices.deviceFingerprint],
        set: {
          platform: sql`excluded.platform`,
          osVersion: sql`coalesce(excluded.os_version, ${devices.osVersion})`,
          appVersion: sql`coalesce(excluded.app_version, ${devices.appVersion})`,
          model: sql`coalesce(excluded.model, ${devices.model})`,
          pushToken: sql`coalesce(excluded.push_token, ${devices.pushToken})`,
          lastSeenAt: sql`now()`,
          lastSeenIp: sql`coalesce(excluded.last_seen_ip, ${devices.lastSeenIp})`,
          // A device the user retired and then opened the app on again is active once more; a
          // BLOCKED one is Risk's decision and announcing yourself does not undo it.
          status: sql`case when ${devices.status} = 'RETIRED' then 'ACTIVE'::identity.device_status else ${devices.status} end`,
        },
      })
      .returning(deviceColumns)
  )[0];
  if (!row) throw new Error('registerDevice: the upsert returned no row');

  return { device: toView(row), isNewDevice: existing === undefined };
}

export async function listDevices(
  db: Db,
  input: { userId: string; page: number; limit: number },
): Promise<Paged<DeviceView>> {
  const [rows, totals] = await Promise.all([
    db
      .select(deviceColumns)
      .from(devices)
      .where(eq(devices.userId, input.userId))
      .orderBy(desc(devices.lastSeenAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(devices)
      .where(eq(devices.userId, input.userId)),
  ]);

  return {
    items: rows.map(toView),
    page: input.page,
    limit: input.limit,
    total: totals[0]?.total ?? 0,
  };
}

/**
 * "This is not my phone any more."
 *
 * The row survives — M13 wants the history, and NDPA retention is two years past last seen — but it
 * stops being pushable immediately, which is the thing the user is actually asking for.
 */
export async function retireDevice(tx: Tx, input: { userId: string; deviceId: string }): Promise<boolean> {
  const updated = await tx
    .update(devices)
    .set({ status: 'RETIRED', pushToken: null, trustedAt: null })
    .where(and(eq(devices.id, input.deviceId), eq(devices.userId, input.userId)))
    .returning({ id: devices.id });
  return updated.length > 0;
}

/**
 * Marks a device the user recognises.
 *
 * In this build trust buys NOTHING at authentication time: §S15 is absolute that a fingerprint is a
 * signal and never an authenticator, so a trusted device still presents a second factor. What it
 * buys is a quieter new-device notification and a signal for M13. The moment a later ticket lets
 * trust skip a factor, this becomes a §S7 action and needs step-up — see the ticket's deferred list.
 */
export async function trustDevice(tx: Tx, input: { userId: string; deviceId: string }): Promise<boolean> {
  const updated = await tx
    .update(devices)
    .set({ status: 'TRUSTED', trustedAt: sql`now()` })
    .where(
      and(
        eq(devices.id, input.deviceId),
        eq(devices.userId, input.userId),
        // A device Risk blocked is not the user's to vouch for.
        eq(devices.status, 'ACTIVE'),
      ),
    )
    .returning({ id: devices.id });
  return updated.length > 0;
}

/** The device behind an id, scoped to its owner. Null when it is not theirs. */
export async function findOwnDevice(
  tx: Tx,
  input: { userId: string; deviceId: string },
): Promise<DeviceView | null> {
  const row = (
    await tx
      .select(deviceColumns)
      .from(devices)
      .where(and(eq(devices.id, input.deviceId), eq(devices.userId, input.userId)))
  )[0];
  return row ? toView(row) : null;
}
