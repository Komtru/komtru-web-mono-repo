CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TYPE "identity"."capability_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "identity"."capability_type" AS ENUM('MERCHANT', 'MERCHANT_MEMBER', 'STAFF');--> statement-breakpoint
CREATE TYPE "identity"."device_status" AS ENUM('ACTIVE', 'TRUSTED', 'BLOCKED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "identity"."invitation_status" AS ENUM('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "identity"."mfa_factor_status" AS ENUM('PENDING', 'ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "identity"."mfa_factor_type" AS ENUM('TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE');--> statement-breakpoint
CREATE TYPE "identity"."otp_channel" AS ENUM('SMS', 'EMAIL', 'WHATSAPP', 'VOICE');--> statement-breakpoint
CREATE TYPE "identity"."otp_purpose" AS ENUM('REGISTRATION', 'LOGIN', 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MFA_CHALLENGE', 'SENSITIVE_ACTION', 'ACCOUNT_RECOVERY');--> statement-breakpoint
CREATE TYPE "identity"."session_scope" AS ENUM('CONSUMER', 'STAFF', 'LOGISTICS');--> statement-breakpoint
CREATE TYPE "identity"."social_provider" AS ENUM('GOOGLE', 'APPLE', 'FACEBOOK');--> statement-breakpoint
CREATE TYPE "identity"."user_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED');--> statement-breakpoint
CREATE TYPE "identity"."verification_level" AS ENUM('UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED');