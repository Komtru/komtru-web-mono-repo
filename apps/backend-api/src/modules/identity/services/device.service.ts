// `identity.devices`, as much of it as a sign-in needs.
//
// A fingerprint is a SIGNAL and never an authenticator (§S15): it is spoofable, and nothing here
// grants access on it. What it buys is the "new sign-in" notification §S11 asks for, and a key the
// rate limiter can count an attacker's handset on across the identifiers they are walking.
//
// T-036 owns devices properly — trust, blocking, retirement, push tokens. This file is the one
// upsert a login cannot do without, and that ticket should absorb it.
import { and, eq, sql } from 'drizzle-orm';
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
