// M1 §5.1. Two deliberate deviations from the spec text, both from later rulings:
//   capability_type drops SELLER and gains MERCHANT — anyone may sell, and MERCHANT is the
//   certified, sell-only capability (design §6.3);
//   session_scope gains LOGISTICS — logistics staff are a capability on the same users row,
//   separated by session scope (design C2, ticket T-031).
import { identity } from './columns.js';

export const userStatus = identity.enum('user_status', [
  'PENDING_VERIFICATION', // registered, no channel verified yet
  'ACTIVE',
  'RESTRICTED', // can log in, cannot transact
  'SUSPENDED', // cannot log in; funds frozen
  'LOCKED', // automated security lock, self-recoverable
  'CLOSED', // user-initiated closure, data retained
  'ANONYMISED', // erasure executed
]);

/**
 * M1 §2's ladder, named as a value because the ORDER is load-bearing: M6 (T-050) stores a level as
 * a NUMBER in its append-only change log and identity stores it as a NAME here, so the array index
 * is the conversion between them. Retyping the list in trust would be a second copy of a ladder
 * whose drift shows up as a user granted the wrong level.
 */
export const VERIFICATION_LEVELS = [
  'UNVERIFIED',
  'CONTACT_VERIFIED',
  'IDENTITY_VERIFIED',
  'BUSINESS_VERIFIED',
  'ENHANCED',
] as const;

export type VerificationLevelName = (typeof VERIFICATION_LEVELS)[number];

export const verificationLevel = identity.enum('verification_level', VERIFICATION_LEVELS);

export const capabilityType = identity.enum('capability_type', ['MERCHANT', 'MERCHANT_MEMBER', 'STAFF']);

export const capabilityStatus = identity.enum('capability_status', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
]);

// Login providers only. Instagram and X are deliberately absent: they are social *proof* (M6),
// never authentication (M1 §7.1–7.2).
export const socialProvider = identity.enum('social_provider', ['GOOGLE', 'APPLE', 'FACEBOOK']);

export const mfaFactorType = identity.enum('mfa_factor_type', [
  'TOTP',
  'SMS_OTP',
  'EMAIL_OTP',
  'PASSKEY',
  'RECOVERY_CODE',
]);

export const mfaFactorStatus = identity.enum('mfa_factor_status', ['PENDING', 'ACTIVE', 'REVOKED']);

export const otpPurpose = identity.enum('otp_purpose', [
  'REGISTRATION',
  'LOGIN',
  'PHONE_VERIFICATION',
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'MFA_CHALLENGE',
  'SENSITIVE_ACTION',
  'ACCOUNT_RECOVERY',
]);

export const otpChannel = identity.enum('otp_channel', ['SMS', 'EMAIL', 'WHATSAPP', 'VOICE']);

export const sessionScope = identity.enum('session_scope', ['CONSUMER', 'STAFF', 'LOGISTICS']);

export const deviceStatus = identity.enum('device_status', ['ACTIVE', 'TRUSTED', 'BLOCKED', 'RETIRED']);

export const invitationStatus = identity.enum('invitation_status', [
  'PENDING',
  'CLAIMED',
  'EXPIRED',
  'CANCELLED',
]);
