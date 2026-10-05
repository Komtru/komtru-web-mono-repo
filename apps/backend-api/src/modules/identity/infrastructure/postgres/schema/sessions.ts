// M1 §5.8. Refresh tokens are opaque and stored as hashes (D5); a session row is the only authority
// on whether one is still live.
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, identity } from './columns.js';
import {
  deviceStatus,
  mfaFactorStatus,
  mfaFactorType,
  otpChannel,
  otpPurpose,
  sessionScope,
} from './enums.js';
import { userPhones } from './contacts.js';
import { users } from './users.js';

export const devices = identity.table(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceFingerprint: text('device_fingerprint').notNull(),
    platform: text('platform').notNull(),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    model: text('model'),
    pushToken: text('push_token'),
    status: deviceStatus('status').notNull().default('ACTIVE'),
    trustedAt: timestamp('trusted_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenIp: inet('last_seen_ip'),
  },
  (table) => [
    uniqueIndex('devices_user_fingerprint').on(table.userId, table.deviceFingerprint),
    // Not unique: one fingerprint across several users is a strong fraud signal for Risk (M13).
    index('devices_fingerprint_idx').on(table.deviceFingerprint),
  ],
);

export const sessions = identity.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    scope: sessionScope('scope').notNull().default('CONSUMER'),
    /** Rotation family: replaying any consumed token kills the whole family (T-031). */
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: bytea('refresh_token_hash').notNull(),
    parentSessionId: uuid('parent_session_id').references((): AnyPgColumn => sessions.id),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    /** How the holder authenticated: ['pwd','otp'], ['passkey']. */
    amr: text('amr')
      .array()
      .notNull()
      .default(sql`'{}'`),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    uniqueIndex('sessions_refresh_hash').on(table.refreshTokenHash),
    index('sessions_user_active_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL AND ${table.consumedAt} IS NULL`),
    index('sessions_family_idx').on(table.familyId),
  ],
);

export const mfaFactors = identity.table(
  'mfa_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    factorType: mfaFactorType('factor_type').notNull(),
    status: mfaFactorStatus('status').notNull().default('PENDING'),
    label: text('label'),
    /** TOTP seed, envelope-encrypted (T-026). */
    secretEnc: bytea('secret_enc'),
    phoneId: uuid('phone_id').references(() => userPhones.id, { onDelete: 'set null' }),
    isDefault: boolean('is_default').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('mfa_factors_user_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex('mfa_factors_one_default')
      .on(table.userId)
      .where(sql`${table.isDefault} AND ${table.revokedAt} IS NULL`),
  ],
);

export const passkeyCredentials = identity.table('passkey_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialId: bytea('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
  aaguid: uuid('aaguid'),
  transports: text('transports')
    .array()
    .notNull()
    .default(sql`'{}'`),
  backedUp: boolean('backed_up').notNull().default(false),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const otpChallenges = identity.table(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: otpPurpose('purpose').notNull(),
    channel: otpChannel('channel').notNull(),
    /** HMAC of the email or phone, never plaintext (T-026). */
    destinationHash: bytea('destination_hash').notNull(),
    codeHash: bytea('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdIp: inet('created_ip'),
  },
  (table) => [
    index('otp_challenges_lookup')
      .on(table.destinationHash, table.purpose)
      .where(sql`${table.consumedAt} IS NULL`),
    index('otp_challenges_expiry').on(table.expiresAt),
  ],
);

/**
 * The highest-risk flow in the module and the one social engineering targets, so it is always
 * human-reviewed above the auto-approve threshold (M1 §5.8).
 */
export const accountRecoveryRequests = identity.table(
  'account_recovery_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Nullable: the requester may not be resolvable to a user at intake. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    claimedIdentifierHash: bytea('claimed_identifier_hash').notNull(),
    /** LOST_PASSWORD | LOST_PHONE | LOST_DEVICE | LOST_ALL | MFA_LOCKOUT. */
    method: text('method').notNull(),
    /** PENDING | CHALLENGED | APPROVED | REJECTED | EXPIRED | COMPLETED. */
    status: text('status').notNull().default('PENDING'),
    /** Soft references to M20 files and an M10 ticket; cross-schema, so no REFERENCES. */
    evidenceRefs: uuid('evidence_refs')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ticketId: uuid('ticket_id'),
    riskScore: smallint('risk_score'),
    requiresHuman: boolean('requires_human').notNull().default(true),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    requestedIp: inet('requested_ip'),
    requestedDeviceId: uuid('requested_device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'recovery_reviewer_not_subject',
      sql`${table.reviewedBy} IS NULL OR ${table.userId} IS NULL OR ${table.reviewedBy} <> ${table.userId}`,
    ),
    index('account_recovery_user_idx').on(table.userId),
    index('account_recovery_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} IN ('PENDING', 'CHALLENGED')`),
  ],
);
