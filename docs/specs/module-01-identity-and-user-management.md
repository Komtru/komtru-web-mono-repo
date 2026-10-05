# Kumtru — Module 1: Identity & User Management

**Implementation specification**
Version 0.2 · 23 August 2026 · Status: Draft for engineering review
*(Revision note: adds D7 — `user_profiles.avatar_url` is replaced with a soft ref to
Module 20's File & Evidence Management, now that M20 exists. See §3 D7, §5.3, §5.6, §10.5,
and the anonymisation procedure in §15.)*

---

## 0. How to read this document

This is the first of the Kumtru module specs. It is deliberately implementation-ready: an engineer should be able to open this, run the DDL, and start building endpoints without inventing structure.

Three rules govern everything below:

1. **One user object.** A person has exactly one `users` row for life. Buyer, seller, merchant staff and admin are *capabilities attached to that row*, not separate account types. A user can hold all of them simultaneously.
2. **Authentication ≠ verification.** This module answers *"is this the person who owns this account?"* It does **not** answer *"who is this person in the real world?"* That is Trust & Verification (Module 6). The boundary is drawn explicitly in §2.
3. **The backend owns identity state.** No client determines whether a session is valid, whether a username is available, or whether a user may act as a seller.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Registration & login | Email, phone, password, OTP, social, passkey |
| Username system | Claim, uniqueness, confusable protection, change policy, history |
| Party lookup | Tag a counterparty by `@username` or email, including non-users |
| Identifiers | Email addresses, phone numbers, normalisation, verification of *control* |
| Credentials | Password hashing, rotation, breach checks |
| Social identities | Provider linking, unlinking, account-takeover defence |
| Sessions & devices | Token issuance, rotation, revocation, device registry |
| MFA | TOTP, SMS OTP, passkeys, biometric unlock |
| Capabilities | Buyer / seller / merchant-member / staff activation |
| Admin RBAC | Roles, permissions, separation of duty |
| Account lifecycle | Suspension, restriction, closure, erasure |
| Account recovery | Lost password, lost phone, lost device, lost everything |
| Identity audit | Append-only record of every auth-sensitive action |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trust & Verification (M6) | NIN, BVN, CAC, liveness, document upload, address proof, trust score |
| Merchant Management (M5) | Store profile, payout config, merchant staff *permissions within a merchant* |
| Payment & Ledger (M8) | Bank accounts, payout destinations |
| Risk & Fraud (M13) | Risk scoring. Identity *emits signals*; it does not score them |
| Reputation (M12) | Ratings, completion rate, dispute rate |
| Notifications (M11) | Actual delivery of OTP SMS/email. Identity requests; Notifications delivers |

> **Boundary note.** Identity stores the *fact* that a user is verified at level N and the *reference* to the verification record. It never stores NIN/BVN values. If you find a BVN column in the identity schema, the boundary has leaked.

---

## 2. The authentication / verification split

```
┌────────────────────────────┐      ┌────────────────────────────┐
│   IDENTITY & ACCESS (M1)   │      │  TRUST & VERIFICATION (M6) │
├────────────────────────────┤      ├────────────────────────────┤
│ Proves control of an        │      │ Proves who a human being   │
│ account and its channels    │      │ is in the real world       │
│                             │      │                            │
│ • password / passkey        │      │ • NIN, BVN                 │
│ • email OTP (owns inbox)    │─────▶│ • face / liveness          │
│ • SMS OTP (owns SIM)        │ user │ • address proof            │
│ • social OAuth              │  id  │ • CAC / business docs      │
│ • device binding            │      │ • bank name match          │
│                             │◀─────│                            │
│ stores: verification_level  │ level│ stores: everything else    │
└────────────────────────────┘      └────────────────────────────┘
```

Identity holds a single denormalised field, `users.verification_level` (0–4). It exists so that authorisation checks ("can this user receive escrow payouts?") do not require a cross-domain call on every request.

**Ownership split:** M1 sets levels 0 and 1 from its own channel-verification events (email and phone are M1-owned state). M6 owns levels 2–4 and raises them via `verification.level_attained` events; M1 never computes them. Downgrades from any level are M6's call except where a user removes a verified channel, which drops them to 0.

| Level | Name | Requirement | Unlocks |
|---|---|---|---|
| 0 | `UNVERIFIED` | Registered only | Browse, receive invitations |
| 1 | `CONTACT_VERIFIED` | Email **and** phone verified | Buy, fund trades, be tagged |
| 2 | `IDENTITY_VERIFIED` | NIN/BVN + liveness passed | Sell, receive settlement |
| 3 | `BUSINESS_VERIFIED` | CAC + business bank match | Merchant tier, higher limits |
| 4 | `ENHANCED` | Enhanced due diligence | Enterprise limits |

---

## 3. Core design decisions

### D1 — One user, many capabilities

Do not build `buyers` and `sellers` tables. A person who buys a laptop on Tuesday and sells a camera on Friday is one identity with one reputation and one KYC record. Splitting them means duplicated KYC, split reputation, and two rows to suspend when someone commits fraud.

```
                        users (1 row per human)
                              │
        ┌──────────┬──────────┼──────────┬──────────────┐
        │          │          │          │              │
     BUYER      SELLER   MERCHANT_    STAFF        (future)
   (implicit)  (opt-in)   MEMBER    (granted)
        │          │          │          │
   always on   needs L2   via merchant  via admin_role_
               to settle   _members     assignments
```

`BUYER` is implicit — never stored, always true for an `ACTIVE` user. Storing it creates a class of bug where someone is inexplicably unable to buy.

### D2 — Staff is on the same object, with hard separation of duty

You asked for fluidity, and it is right: your ops team will absolutely use Kumtru personally, and forcing a second account would be worse — they would use a personal account anyway and you would lose the linkage.

So: **same user row, separate credential path.**

| Control | Rule |
|---|---|
| C1 | A session may be *either* consumer-scoped or staff-scoped, never both. Staff scope requires a distinct login at `/auth/staff/login`. |
| C2 | Staff-scoped sessions **cannot** be established via social login. Password + MFA only. |
| C3 | Staff sessions have a 30-minute idle TTL and 8-hour absolute TTL. Consumer sessions: 30 days sliding. |
| C4 | MFA is mandatory for any user holding an admin role. Granting a role to a user without MFA enrols them into a forced-setup state. |
| C5 | **Self-dealing block.** Any admin action is rejected if the acting user is a party to, or shares a device/payout instrument with, the subject trade. Enforced at the permission-check layer, not by policy. |
| C6 | Admin role grants are time-boxed by default (`expires_at`, max 365 days) and require a second approver for `FINANCE_ADMIN`, `SUPER_ADMIN`, `COMPLIANCE_OFFICER`. |

### D3 — Username is a first-class, protected asset

On a payments-and-trust platform, a username is not a nickname. It is how a buyer confirms they are paying the right person. `@dellstore_ng` versus `@dellst0re_ng` is a fraud vector, and it *will* be exploited. See §6 in full.

### D4 — Phone is a primary identifier, not an attribute

Kumtru is Nigerian and social. A large share of users will register phone-first. Phone numbers must be:

- Stored **only** in E.164 (`+2348012345678`), normalised at the edge via `libphonenumber-js`.
- Globally unique among *verified* numbers.
- Re-verified if unused for 12 months — SIM recycling in Nigeria is real, and an unrecycled stale phone binding is an account-takeover path.

### D5 — Opaque refresh tokens, not stateless-only JWTs

A pure stateless JWT design means a fraud analyst who suspends an account cannot actually kick that account out until the token expires. On a platform moving money, that is unacceptable. Design:

- **Access token:** JWT, EdDSA (Ed25519), 10-minute TTL, verified locally by services via JWKS.
- **Refresh token:** opaque 256-bit random, stored hashed (SHA-256), rotated on every use, with **reuse detection** — replay of a consumed refresh token revokes the entire token family and raises a `identity.session.reuse_detected` event to Risk.
- **Kill switch:** a `sessions_epoch` integer on `users`. Suspension increments it; it is embedded in every access token as `epc`. Services reject tokens whose `epc` is stale via a Redis-cached epoch map. Worst-case exposure: one Redis TTL, ~10 seconds, not 10 minutes.
- **The kill switch alone is not sufficient.** Bumping the epoch only invalidates *issued access tokens*; the refresh token row is untouched, so a suspended user could call `/auth/refresh` and mint a fresh token carrying the new epoch. Suspension must therefore do all three things in one database transaction: increment `sessions_epoch`, set `revoked_at` on every non-revoked `sessions` row for that user, and `/auth/refresh` must re-read `users.status` and reject anything other than `ACTIVE`, `PENDING_VERIFICATION` or `RESTRICTED`.

### D6 — Never link accounts on an unverified provider email

The single most common OAuth vulnerability. If a provider returns `email: victim@example.com` without asserting verification, and you auto-link, anyone who can set that email on that provider owns the Kumtru account. Rules in §7.4.

### D7 — Avatar photos are a soft ref to Module 20, never a raw URL column

`user_profiles.avatar_file_id` references a file uploaded through M20's `PROFILE_PHOTO` category (M20 §2 D5) and resolved to a short-lived signed URL at read time — never a permanently stored or cached URL sitting in this row. This closes a real gap rather than a hypothetical one: M20 (File & Evidence Management) didn't exist when this module was first specced, so `avatar_url` was written as a placeholder raw-text column. Now that M20 exists, D1's whole rationale for *every other* module — one file service, no module holding its own ad hoc file-serving path — applies to this module's own schema too. This is a build requirement for M1, confirmed 2026-08-23, not an optional cleanup.

---

## 4. Entity model

```
                                ┌───────────────┐
                                │     users     │
                                └───────┬───────┘
                                        │
   ┌────────────┬───────────┬───────────┼───────────┬────────────┬───────────┐
   │            │           │           │           │            │           │
┌──▼─────────┐ ┌▼─────────┐ ┌▼────────┐ ┌▼────────┐ ┌▼─────────┐ ┌▼────────┐ ┌▼──────────┐
│user_       │ │user_     │ │user_    │ │user_    │ │social_   │ │user_    │ │admin_role_│
│profiles    │ │emails    │ │phones   │ │creden-  │ │identities│ │capabil- │ │assignments│
│  (1:1)     │ │ (1:N)    │ │ (1:N)   │ │tials    │ │ (1:N)    │ │ities    │ │  (1:N)    │
└────────────┘ └──────────┘ └─────────┘ └─────────┘ └──────────┘ └─────────┘ └───────────┘
                                        │
   ┌────────────┬───────────┬───────────┼───────────┬────────────┬───────────┐
   │            │           │           │           │            │           │
┌──▼────────┐ ┌─▼────────┐ ┌▼────────┐ ┌▼────────┐ ┌▼─────────┐ ┌▼─────────┐ ┌▼──────────┐
│  devices  │ │ sessions │ │mfa_     │ │passkey_ │ │username_ │ │identity_ │ │account_   │
│           │ │          │ │factors  │ │creden-  │ │history   │ │audit_log │ │recovery_  │
│           │ │          │ │         │ │tials    │ │          │ │(append)  │ │requests   │
└───────────┘ └──────────┘ └─────────┘ └─────────┘ └──────────┘ └──────────┘ └───────────┘

Standalone:
  reserved_usernames   otp_challenges   party_invitations
  roles   permissions   role_permissions   admin_action_approvals
```

---

## 5. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE SCHEMA IF NOT EXISTS identity;
SET search_path TO identity, public;
```

### 5.1 Enumerations

```sql
CREATE TYPE user_status AS ENUM (
  'PENDING_VERIFICATION',  -- registered, no channel verified yet
  'ACTIVE',
  'RESTRICTED',            -- can log in, cannot transact
  'SUSPENDED',             -- cannot log in; funds frozen
  'LOCKED',                -- automated security lock, self-recoverable
  'CLOSED',                -- user-initiated closure, data retained
  'ANONYMISED'             -- erasure executed
);

CREATE TYPE verification_level AS ENUM (
  'UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED',
  'BUSINESS_VERIFIED', 'ENHANCED'
);

CREATE TYPE capability_type AS ENUM ('SELLER', 'MERCHANT_MEMBER', 'STAFF');

CREATE TYPE capability_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- Login providers only. Instagram and X are deliberately absent: they are
-- social *proof* (M6), never authentication. See §7.1–7.2.
CREATE TYPE social_provider AS ENUM ('GOOGLE', 'APPLE', 'FACEBOOK');

CREATE TYPE mfa_factor_type AS ENUM ('TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE');

CREATE TYPE mfa_factor_status AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TYPE otp_purpose AS ENUM (
  'REGISTRATION', 'LOGIN', 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION',
  'PASSWORD_RESET', 'MFA_CHALLENGE', 'SENSITIVE_ACTION', 'ACCOUNT_RECOVERY'
);

CREATE TYPE otp_channel AS ENUM ('SMS', 'EMAIL', 'WHATSAPP', 'VOICE');

CREATE TYPE session_scope AS ENUM ('CONSUMER', 'STAFF');

CREATE TYPE device_status AS ENUM ('ACTIVE', 'TRUSTED', 'BLOCKED', 'RETIRED');

CREATE TYPE invitation_status AS ENUM ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED');
```

### 5.2 `users` — the single identity row

```sql
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-facing stable reference, e.g. 'KMT-U-7F3K9Q'. Safe to expose.
  public_id             text NOT NULL UNIQUE,

  -- Username. citext gives case-insensitive uniqueness for free.
  username              citext UNIQUE,
  -- Confusable-folded form. THIS is the real anti-impersonation guard. See §6.3.
  username_skeleton     text UNIQUE,
  -- Which version of the skeleton algorithm produced username_skeleton.
  -- Required for grandfathering when the algorithm is tightened. See §6.3.
  skeleton_version      smallint NOT NULL DEFAULT 1,
  username_set_at       timestamptz,
  username_change_count integer NOT NULL DEFAULT 0,

  status                user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  status_reason         text,
  status_changed_at     timestamptz NOT NULL DEFAULT now(),

  verification_level    verification_level NOT NULL DEFAULT 'UNVERIFIED',
  verification_synced_at timestamptz,

  -- Denormalised pointers to the primary contact rows (see 5.3 / 5.4).
  primary_email_id      uuid,
  primary_phone_id      uuid,

  -- Incremented to invalidate every outstanding access token instantly.
  sessions_epoch        integer NOT NULL DEFAULT 1,

  -- Discovery / tagging privacy. Defaults are permissive because tagging is
  -- core to the product; users may tighten them.
  discoverable_by_username boolean NOT NULL DEFAULT true,
  discoverable_by_email    boolean NOT NULL DEFAULT true,
  discoverable_by_phone    boolean NOT NULL DEFAULT true,

  mfa_required          boolean NOT NULL DEFAULT false,
  mfa_enrolled_at       timestamptz,

  last_login_at         timestamptz,
  registered_via        text,     -- 'EMAIL' | 'PHONE' | 'GOOGLE' | 'APPLE' | ...
  registration_ip       inet,
  locale                text NOT NULL DEFAULT 'en-NG',
  timezone              text NOT NULL DEFAULT 'Africa/Lagos',

  -- NDPA lawful-basis capture (§15).
  terms_version         text,
  privacy_version       text,
  consent_recorded_at   timestamptz,
  consent_ip            inet,
  marketing_opt_in      boolean NOT NULL DEFAULT false,
  marketing_opt_in_at   timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  anonymised_at         timestamptz,

  -- Cast to text: citext folds case in `~`, so without the cast this CHECK
  -- would accept 'JaneDoe'.
  CONSTRAINT users_username_format CHECK (
    username IS NULL OR username::text ~ '^[a-z][a-z0-9._]{2,29}$'
  ),
  CONSTRAINT users_username_pair CHECK (
    (username IS NULL AND username_skeleton IS NULL)
    OR (username IS NOT NULL AND username_skeleton IS NOT NULL)
  )
);

CREATE INDEX users_status_idx      ON users (status);
CREATE INDEX users_created_at_idx  ON users (created_at DESC);
CREATE INDEX users_ver_level_idx   ON users (verification_level);
```

> `username` is nullable: social sign-up completes before the user picks a handle. A user without a username can browse and buy but **cannot be tagged and cannot sell**. The onboarding flow should force the choice at first meaningful action.

### 5.3 `user_profiles` — display data (1:1)

```sql
CREATE TABLE user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    text,
  first_name      text,
  last_name       text,
  avatar_file_id  uuid,   -- soft ref to M20 (category PROFILE_PHOTO) — D7
  bio             text,
  date_of_birth   date,
  gender          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_bio_len CHECK (bio IS NULL OR length(bio) <= 500)
);
```

> `first_name` / `last_name` here are **self-declared**, not legal names. Legal name lives in M6 and is the one that matters for payouts. Do not conflate them; a user calling themselves "Big Mike" must not break a bank-name match.
>
> `avatar_file_id` is nullable — a user with no uploaded avatar has none, resolved client-side to a generated placeholder, never a broken link.

### 5.4 Contact channels

```sql
CREATE TABLE user_emails (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          citext NOT NULL,
  -- Provider-normalised (gmail dot/plus folding) for duplicate detection only.
  email_normal   citext NOT NULL,
  is_primary     boolean NOT NULL DEFAULT false,
  verified_at    timestamptz,
  verification_source text,          -- 'OTP' | 'OAUTH_GOOGLE' | 'ADMIN'
  bounce_count   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Only ONE verified account may own a given address. Indexed on the NORMALISED
-- form, otherwise j.ane@gmail.com and jane@gmail.com verify onto two accounts.
CREATE UNIQUE INDEX user_emails_verified_unique
  ON user_emails (email_normal) WHERE verified_at IS NOT NULL;
CREATE UNIQUE INDEX user_emails_one_primary
  ON user_emails (user_id) WHERE is_primary;
CREATE INDEX user_emails_user_idx   ON user_emails (user_id);
CREATE INDEX user_emails_email_idx  ON user_emails (email);
-- Composite key so users.primary_email_id can be constrained to the same user.
CREATE UNIQUE INDEX user_emails_id_user ON user_emails (id, user_id);

CREATE TABLE user_phones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164     text NOT NULL,
  country_code   text NOT NULL,
  is_primary     boolean NOT NULL DEFAULT false,
  verified_at    timestamptz,
  -- Forces re-verification of stale numbers (SIM recycling defence).
  reverify_after timestamptz,
  carrier        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE UNIQUE INDEX user_phones_verified_unique
  ON user_phones (phone_e164) WHERE verified_at IS NOT NULL;
CREATE UNIQUE INDEX user_phones_one_primary
  ON user_phones (user_id) WHERE is_primary;
CREATE INDEX user_phones_user_idx ON user_phones (user_id);
CREATE UNIQUE INDEX user_phones_id_user ON user_phones (id, user_id);

-- Composite FKs. A simple FK on (primary_email_id) would happily let user A's
-- primary email point at user B's row; this makes that impossible.
ALTER TABLE users
  ADD CONSTRAINT users_primary_email_fk
    FOREIGN KEY (primary_email_id, id) REFERENCES user_emails(id, user_id)
    ON DELETE SET NULL (primary_email_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT users_primary_phone_fk
    FOREIGN KEY (primary_phone_id, id) REFERENCES user_phones(id, user_id)
    ON DELETE SET NULL (primary_phone_id) DEFERRABLE INITIALLY DEFERRED;
```

> `ON DELETE SET NULL (column)` requires PostgreSQL 15+. On 14 or earlier, drop the composite FK and enforce the same-user invariant with a trigger — do not silently fall back to the simple FK.

### 5.5 Credentials

```sql
CREATE TABLE user_credentials (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash     text NOT NULL,          -- argon2id, full PHC string
  algorithm         text NOT NULL DEFAULT 'argon2id',
  -- Retain last N hashes to block reuse. Hashes only, never plaintext.
  previous_hashes   text[] NOT NULL DEFAULT '{}',
  must_change       boolean NOT NULL DEFAULT false,
  breached_at       timestamptz,            -- set by k-anonymity HIBP check
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  password_set_at   timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

> A social-only user has **no row here**. That is legal and expected. Attempting password login for such a user must return the same generic error as a wrong password — never "this account uses Google", which is a free account-enumeration oracle.

### 5.6 Social identities

```sql
CREATE TABLE social_identities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              social_provider NOT NULL,
  provider_user_id      text NOT NULL,        -- 'sub' claim; immutable
  provider_username     text,                 -- @handle, for display/social proof
  provider_email        citext,
  provider_email_verified boolean NOT NULL DEFAULT false,
  provider_avatar_url   text,
  -- Only stored when the provider grants ongoing API scopes we actually use.
  access_token_enc      bytea,
  refresh_token_enc     bytea,
  token_expires_at      timestamptz,
  scopes                text[] NOT NULL DEFAULT '{}',
  raw_profile           jsonb,
  linked_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz,
  unlinked_at           timestamptz
);

CREATE UNIQUE INDEX social_identities_provider_subject
  ON social_identities (provider, provider_user_id) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX social_identities_one_per_provider
  ON social_identities (user_id, provider) WHERE unlinked_at IS NULL;
CREATE INDEX social_identities_user_idx ON social_identities (user_id);
```

> `provider_avatar_url` is raw source metadata about the linked identity only — it is never assigned directly to `user_profiles.avatar_file_id`. If the user chooses to use their Google/Apple picture as their Kumtru avatar, the app fetches it server-side and uploads it through M20's normal `PROFILE_PHOTO` flow (§10.5) like any other avatar, precisely because an external provider URL can change or be revoked without Kumtru's knowledge — D7 requires every avatar to be a file this platform actually stores and controls access to.

### 5.7 Capabilities and admin RBAC

```sql
CREATE TABLE user_capabilities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability     capability_type NOT NULL,
  status         capability_status NOT NULL DEFAULT 'PENDING',
  activated_at   timestamptz,
  suspended_at   timestamptz,
  suspension_reason text,
  granted_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_capabilities_unique ON user_capabilities (user_id, capability);

CREATE TABLE roles (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  description    text,
  is_staff_role  boolean NOT NULL DEFAULT true,
  requires_dual_approval boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  code           text PRIMARY KEY,           -- 'trade.refund'
  domain         text NOT NULL,              -- 'trade'
  action         text NOT NULL,              -- 'refund'
  description    text,
  is_financial   boolean NOT NULL DEFAULT false,
  is_destructive boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
  role_code       text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE admin_role_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code      text NOT NULL REFERENCES roles(code),
  granted_by     uuid NOT NULL REFERENCES users(id),
  approved_by    uuid REFERENCES users(id),      -- required if dual approval
  reason         text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES users(id),
  revoke_reason  text,

  -- Four-eyes: the approver can never be the grantor.
  CONSTRAINT admin_role_distinct_approver
    CHECK (approved_by IS NULL OR approved_by <> granted_by),
  CONSTRAINT admin_role_no_self_grant
    CHECK (granted_by <> user_id)
);

-- Presence of an approver for dual-approval roles cannot be expressed as a
-- CHECK (it depends on roles.requires_dual_approval), so enforce it here.
CREATE FUNCTION enforce_dual_approval() RETURNS trigger AS $$
BEGIN
  IF (SELECT requires_dual_approval FROM roles WHERE code = NEW.role_code)
     AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'role % requires a second approver', NEW.role_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_role_dual_approval
  BEFORE INSERT OR UPDATE ON admin_role_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_dual_approval();

-- Second approver for administrative *actions* (MFA reset, forced username
-- change, large refunds). Distinct from role-grant approval above.
CREATE TABLE admin_action_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action         text NOT NULL,              -- 'MFA_RESET', 'USERNAME_FORCE_CHANGE'
  subject_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by   uuid NOT NULL REFERENCES users(id),
  approved_by    uuid REFERENCES users(id),
  reason         text NOT NULL,
  payload        jsonb,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  executed_at    timestamptz,
  expires_at     timestamptz NOT NULL,
  rejected_at    timestamptz,
  rejection_reason text,
  CONSTRAINT admin_action_distinct_approver
    CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX admin_action_approvals_pending_idx
  ON admin_action_approvals (action, requested_at)
  WHERE approved_at IS NULL AND rejected_at IS NULL;

CREATE UNIQUE INDEX admin_role_active_unique
  ON admin_role_assignments (user_id, role_code) WHERE revoked_at IS NULL;
CREATE INDEX admin_role_expiry_idx
  ON admin_role_assignments (expires_at) WHERE revoked_at IS NULL;
```

### 5.8 Sessions, devices, MFA

```sql
CREATE TABLE devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  platform           text NOT NULL,        -- 'IOS' | 'ANDROID' | 'WEB'
  os_version         text,
  app_version        text,
  model              text,
  push_token         text,
  status             device_status NOT NULL DEFAULT 'ACTIVE',
  trusted_at         timestamptz,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_ip       inet
);

CREATE UNIQUE INDEX devices_user_fingerprint ON devices (user_id, device_fingerprint);
-- Shared-device detection is a strong fraud signal for Risk (M13).
CREATE INDEX devices_fingerprint_idx ON devices (device_fingerprint);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          uuid REFERENCES devices(id) ON DELETE SET NULL,
  scope              session_scope NOT NULL DEFAULT 'CONSUMER',
  -- Rotation family: replay of any consumed token kills the whole family.
  family_id          uuid NOT NULL,
  refresh_token_hash bytea NOT NULL,
  parent_session_id  uuid REFERENCES sessions(id),
  ip                 inet,
  user_agent         text,
  amr                text[] NOT NULL DEFAULT '{}',  -- ['pwd','otp'] / ['passkey']
  issued_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at    timestamptz NOT NULL,
  consumed_at        timestamptz,
  revoked_at         timestamptz,
  revoke_reason      text
);

CREATE UNIQUE INDEX sessions_refresh_hash ON sessions (refresh_token_hash);
CREATE INDEX sessions_user_active_idx ON sessions (user_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE mfa_factors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factor_type    mfa_factor_type NOT NULL,
  status         mfa_factor_status NOT NULL DEFAULT 'PENDING',
  label          text,
  secret_enc     bytea,                    -- TOTP seed, envelope-encrypted
  phone_id       uuid REFERENCES user_phones(id) ON DELETE SET NULL,
  is_default     boolean NOT NULL DEFAULT false,
  verified_at    timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

CREATE INDEX mfa_factors_user_idx ON mfa_factors (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX mfa_factors_one_default
  ON mfa_factors (user_id) WHERE is_default AND revoked_at IS NULL;

CREATE TABLE passkey_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     bytea NOT NULL UNIQUE,
  public_key        bytea NOT NULL,
  sign_count        bigint NOT NULL DEFAULT 0,
  aaguid            uuid,
  transports        text[] NOT NULL DEFAULT '{}',
  backed_up         boolean NOT NULL DEFAULT false,
  label             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz
);

CREATE TABLE otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose          otp_purpose NOT NULL,
  channel          otp_channel NOT NULL,
  destination_hash bytea NOT NULL,        -- HMAC of email/phone, never plaintext
  code_hash        bytea NOT NULL,        -- HMAC-SHA256 of the code
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_ip       inet
);

CREATE INDEX otp_challenges_lookup ON otp_challenges (destination_hash, purpose)
  WHERE consumed_at IS NULL;
CREATE INDEX otp_challenges_expiry ON otp_challenges (expires_at);

-- Account recovery: the highest-risk flow in the module, and the one social
-- engineering targets. Always human-reviewed above the auto-approve threshold.
CREATE TABLE account_recovery_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable: the requester may not be resolvable to a user at intake.
  claimed_identifier_hash bytea NOT NULL,
  method             text NOT NULL,   -- 'LOST_PASSWORD'|'LOST_PHONE'|
                                      -- 'LOST_DEVICE'|'LOST_ALL'|'MFA_LOCKOUT'
  status             text NOT NULL DEFAULT 'PENDING',
                                      -- PENDING|CHALLENGED|APPROVED|
                                      -- REJECTED|EXPIRED|COMPLETED
  evidence_refs      uuid[] NOT NULL DEFAULT '{}',   -- File & Evidence (M20)
  ticket_id          uuid,                           -- Tickets (M10)
  risk_score         smallint,
  requires_human     boolean NOT NULL DEFAULT true,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  decision_reason    text,
  requested_ip       inet,
  requested_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  completed_at       timestamptz,
  CONSTRAINT recovery_reviewer_not_subject
    CHECK (reviewed_by IS NULL OR user_id IS NULL OR reviewed_by <> user_id)
);

CREATE INDEX account_recovery_user_idx ON account_recovery_requests (user_id);
CREATE INDEX account_recovery_pending_idx
  ON account_recovery_requests (created_at) WHERE status IN ('PENDING','CHALLENGED');
```

### 5.9 Username protection tables

```sql
CREATE TABLE username_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username        citext NOT NULL,
  username_skeleton text NOT NULL,
  skeleton_version smallint NOT NULL DEFAULT 1,
  claimed_at      timestamptz NOT NULL,
  released_at     timestamptz,
  -- Old handles are quarantined so an attacker cannot inherit trust-by-association.
  quarantine_until timestamptz,
  changed_by      uuid REFERENCES users(id),
  reason          text
);

CREATE INDEX username_history_user_idx ON username_history (user_id);
CREATE INDEX username_history_quarantine_idx ON username_history (username_skeleton)
  WHERE quarantine_until IS NOT NULL;

CREATE TABLE reserved_usernames (
  username_skeleton text PRIMARY KEY,
  category          text NOT NULL,  -- 'BRAND'|'SYSTEM'|'ROLE'|'OFFENSIVE'|'PARTNER'
  note              text,
  releasable        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

### 5.10 Party invitations (tagging a non-user)

```sql
CREATE TABLE party_invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel           otp_channel NOT NULL,
  destination_hash  bytea NOT NULL,      -- HMAC of the email/phone invited
  destination_masked text NOT NULL,      -- 'j••••@gmail.com' for display
  destination_enc   bytea NOT NULL,      -- envelope-encrypted, for sending
  intended_role     text NOT NULL,       -- 'BUYER' | 'SELLER'
  context_type      text,                -- 'TRADE'
  context_id        uuid,                -- trade id, if any
  token_hash        bytea NOT NULL UNIQUE,
  status            invitation_status NOT NULL DEFAULT 'PENDING',
  claimed_by_user_id uuid REFERENCES users(id),
  claimed_at        timestamptz,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX party_invitations_dest_idx ON party_invitations (destination_hash)
  WHERE status = 'PENDING';
CREATE INDEX party_invitations_inviter_idx ON party_invitations (inviter_user_id);
```

### 5.11 Identity audit log (append-only)

```sql
CREATE TABLE identity_audit_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,                -- NULL for system/anonymous
  actor_type    text NOT NULL,       -- 'USER'|'STAFF'|'SYSTEM'|'ANONYMOUS'
  subject_user_id uuid,
  action        text NOT NULL,       -- 'PASSWORD_CHANGED', 'ROLE_GRANTED', ...
  outcome       text NOT NULL,       -- 'SUCCESS'|'FAILURE'|'DENIED'
  ip            inet,
  user_agent    text,
  device_id     uuid,
  session_id    uuid,
  before_state  jsonb,
  after_state   jsonb,
  metadata      jsonb,
  correlation_id uuid
);

CREATE INDEX identity_audit_subject_idx ON identity_audit_log (subject_user_id, occurred_at DESC);
CREATE INDEX identity_audit_actor_idx   ON identity_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX identity_audit_action_idx  ON identity_audit_log (action, occurred_at DESC);

-- REVOKE ... FROM PUBLIC would be a no-op here: PUBLIC never holds these
-- privileges by default, and the table owner keeps them regardless. Grant
-- positively to the application role instead, and back it with a trigger.
GRANT INSERT, SELECT ON identity_audit_log TO kumtru_app;
GRANT USAGE, SELECT ON SEQUENCE identity_audit_log_id_seq TO kumtru_app;

CREATE FUNCTION identity_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER identity_audit_no_mutate
  BEFORE UPDATE OR DELETE ON identity_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION identity_audit_immutable();
```

> The application must connect as `kumtru_app`, never as the table owner or a superuser. Migrations run as the owner in a separate connection. If the app can `ALTER TABLE`, the audit log is decorative.

---

## 6. Username system

### 6.1 Format rules

| Rule | Value |
|---|---|
| Length | 3–30 characters |
| Charset | `a–z`, `0–9`, `.`, `_` |
| First character | Must be a letter |
| Last character | Must be alphanumeric |
| Separators | No two consecutive (`a__b`, `a._b` rejected) |
| Case | Stored and compared lowercase; display preserves nothing — canonical only |
| Digits-only | Rejected (prevents confusion with `public_id` and phone numbers) |

Regex: `^[a-z](?:[a-z0-9]|[._](?=[a-z0-9])){1,28}[a-z0-9]$`

The DB `CHECK` in §5.2 is deliberately looser than the application regex — it is a backstop, not the policy. The application rule is authoritative.

### 6.2 Reserved namespace

Seed `reserved_usernames` before launch with at minimum:

```
System:   kumtru, kumtruapp, kumtruofficial, admin, administrator, root, system,
          support, help, helpdesk, security, verify, verified, official, staff,
          api, www, mail, ftp, cdn, status, blog, app, dev, test, staging
Money:    escrow, payment, payments, payout, refund, wallet, billing, finance,
          settlement, invoice, bank, transfer
Trust:    kyc, compliance, moderator, mod, trust, safety, fraud, dispute
Partners: paystack, flutterwave, gtbank, zenith, opay, moniepoint, kuda, gig,
          dhl, fedex  (+ any partner brand you integrate)
```

Plus a profanity/hate list and a squatter list for major Nigerian brands. Reservation is checked against the **skeleton**, so `adm1n` and `аdmin` (Cyrillic а) are both caught.

### 6.3 Confusable protection — the important part

This is the difference between a username system and a fraud surface. On a platform where a buyer confirms a counterparty by reading a handle, near-identical handles are an attack.

**Skeleton algorithm** (deterministic, versioned):

```
skeleton(u):
  1. NFKC-normalise
  2. lowercase (Unicode simple case fold)
  3. strip all separators: '.' and '_'
  4. map confusables to a canonical representative, using the Unicode
     confusables.txt skeleton algorithm (UTS #39) plus a Kumtru overlay:
        0→o   1→l   3→e   4→a   5→s   6→g   7→t   8→b   9→g
        rn→m  vv→w  cl→d  ii→u
  5. collapse runs of the same character to one:  'daaave' → 'dave'
  6. return result
```

`username_skeleton` carries a `UNIQUE` constraint. Consequences:

Worked example — note that run collapsing turns `ll` into `l`, so the skeleton is `delstoreng`, not `dellstoreng`:

| Attempt | Skeleton | Result |
|---|---|---|
| `dellstore_ng` | `delstoreng` | claimed |
| `dell.store.ng` | `delstoreng` | **rejected** |
| `dellst0re_ng` | `delstoreng` | **rejected** |
| `de11store.ng` | `delstoreng` | **rejected** |
| `dellstoreee_ng` | `delstoreng` | **rejected** |

Two notes on the trade-off. First, step 5 (run collapsing) is aggressive and will reject some legitimate handles — accept that; the false-positive cost is a mildly annoyed user, the false-negative cost is a defrauded one. Second, **version the algorithm** per row, not in config: `users.skeleton_version` and `username_history.skeleton_version` record which version produced each stored value. If you tighten the algorithm later, existing usernames are grandfathered at their stored version; you re-run the new folder in report-only mode over the whole table and hand collisions to Trust & Safety rather than mass-renaming users.

Also restrict the script: for launch, reject any username containing non-ASCII characters entirely. It costs you nothing in Nigeria and removes the entire homoglyph class.

### 6.4 Change policy

| Rule | Value |
|---|---|
| Cooldown | 1 change per 30 days |
| Lifetime cap | 3 self-service changes; further changes require a support ticket |
| Blocked while | Any trade not in a terminal state involves this user |
| Quarantine | Old handle unclaimable by anyone for 90 days; reclaimable by the original owner for 30 days |
| Verified sellers | Level ≥ 2 sellers with completed trades require support approval to change |
| Notification | Change notifies **all** counterparties from the last 90 days |

**Snapshot rule (cross-module contract).** Every trade, dispute, ticket and audit record must persist `counterparty_username_at_time` and `counterparty_public_id` at creation. Never resolve a historical username at read time. Otherwise a seller renames after a dispute and your evidence trail silently rewrites itself.

### 6.5 Suggestion on collision

When a handle is taken, return three suggestions generated from the requested string plus a numeric or word suffix, each pre-checked against skeleton uniqueness and the reserved list. Never suggest something confusable with an *existing high-reputation account* — that is helping an attacker.

---

## 7. Social authentication

### 7.1 Provider assessment (verified August 2026)

| Provider | Verdict | Reasoning |
|---|---|---|
| **Google** | **Ship at launch** | Free, OIDC-compliant, returns `email_verified`, enormous Android reach in Nigeria. Lowest-risk integration. |
| **Apple** | **Ship at launch — mandatory** | App Store Guideline 4.8: an app that offers *any* third-party social login for primary account setup **must** offer an equivalent privacy-preserving option. Without it, iOS review rejects you. Cost: the $99/yr developer programme you already need. Note the private-relay email quirk in §7.3. |
| **Facebook** | **Phase 2** | Free and still widely used in Nigeria, but requires Meta business verification and app review for `email` scope, and does not always assert email verification. Real integration and maintenance cost for declining marginal reach. |
| **Instagram** | **Do not use for login** | Meta deprecated the Instagram Basic Display API on 4 December 2024. The replacement (Instagram API with Instagram Login / Graph API) only supports **Professional (Business/Creator) accounts**. A consumer login button would fail for most personal accounts. |
| **X** | **Do not use for login** | X moved to pay-per-use as the default in February 2026 (~$0.005 per read; legacy flat Basic/Pro closed to new signups and auto-migrated from 1 June 2026). Sign-in requires a profile read per login, so you would be paying per authentication on a rate-limited API with a hostile pricing history. |

**Recommendation: Google + Apple at launch. Facebook in phase 2 if data justifies it. Neither Instagram nor X as authentication.**

### 7.2 Instagram and X, done correctly

You want these for a *social* reason, not an authentication reason — a seller's Instagram presence is meaningful social proof to a Nigerian buyer. Serve that need in the right module:

```
Identity (M1)                    Trust & Verification (M6)
─────────────                    ─────────────────────────
Google  ─ login                  Instagram handle ─ claimed, then
Apple   ─ login                  verified via a one-time bio/post
Facebook─ login (P2)             code challenge → "Social presence
                                  verified" badge on merchant profile
                                 X handle ─ same pattern
```

This gets the trust signal with zero API spend and no login-availability dependency on a third party's pricing decisions. Build it as `social_proof_claims` in M6, not as `social_identities` here.

### 7.3 Provider-specific handling

**Apple.** `email` and `name` are returned **only on the very first authorisation** and never again. If you fail to persist them on first callback, they are gone permanently and the user must revoke the app in iOS settings to re-trigger. Private relay addresses (`xxx@privaterelay.appleid.com`) are real and deliverable but must never be treated as a stable personal address for account recovery — always prompt private-relay users to add a direct address before enabling seller capability. Also register the server-to-server notification endpoint for the Services ID (Apple began requiring this for Korea-based developers from 1 January 2026; register it regardless — it is how you learn about revocations and deletions).

**Google.** Verify the ID token against Google's JWKS, check `iss`, `aud`, `exp`, and **require `email_verified === true`** before any linking decision. `sub` is the stable key; the email is not.

**Facebook.** Requires explicit `email` permission via app review; users may deny it. Handle the no-email case by falling back to a phone-verification step rather than blocking registration.

### 7.4 Account linking rules — non-negotiable

```
Social callback with (provider, sub, email, email_verified)
   │
   ├─ social_identities row exists for (provider, sub)?
   │     └─ YES → log in as that user. Done. Email is irrelevant here.
   │
   ├─ NO → is there a session already active?
   │     └─ YES → LINK to the current user (explicit user-initiated link).
   │              Reject if that user already has an identity for this provider.
   │
   └─ NO session → does a VERIFIED user_emails row match this email?
         │
         ├─ NO MATCH
         │     └─ ✅ Register a new user. status = PENDING_VERIFICATION,
         │          verification_level = UNVERIFIED, username = NULL.
         │          Mark the email verified ONLY if email_verified is TRUE.
         │          Emit identity.user.registered → response isNewUser: true,
         │          nextStep: CHOOSE_USERNAME.
         │
         ├─ MATCH, but email_verified from provider is FALSE
         │     └─ ❌ NEVER auto-link. Create a pending link and require an
         │          OTP to the existing address, or offer password login.
         │
         └─ MATCH and email_verified is TRUE
               ├─ Existing account has NO usable authenticator of its own —
               │  no user_credentials row, no other social_identities row,
               │  no passkey_credentials, no ACTIVE mfa_factors
               │     └─ ✅ Auto-link. Emit identity.social_identity.linked.
               │
               └─ Existing account HAS any authenticator (password, passkey,
                  TOTP, other social)
                     └─ ⚠️ Require step-up: the user must authenticate with an
                        existing factor before the link completes. Notify the
                        account owner by email and push regardless of outcome.
```

The auto-link condition is deliberately narrow. "No password" is *not* sufficient — an account whose only credential is a passkey or a TOTP factor is strongly authenticated, and silently attaching a Google identity to it would downgrade its security to whatever Google's account recovery allows.

Additional rules:

- **Unlinking** is only permitted if the user retains at least one other usable login method. Removing the last one must offer to set a password in the same flow.
- **A social identity may never be moved between users.** Unlink then relink; both are audited events.
- **Provider account deletion webhooks** (Apple, Facebook) must revoke the link and notify, not delete the Kumtru user.
- Registration via social **never** confers verification level > 0. `email_verified` from Google means Google verified an inbox; it says nothing about a human.

---

## 8. Party lookup and tagging

This is the feature you asked for and it is the most privacy-sensitive endpoint in the module. A naïve implementation gives an attacker a way to enumerate every user and to confirm whether any given email address belongs to a Kumtru account.

### 8.1 Behaviour

```
Seller creating a trade
        │
        ├─ types "@janedoe"       ──▶ exact username lookup
        ├─ types "jane@mail.com"  ──▶ exact email lookup
        └─ types "+2348012345678" ──▶ exact phone lookup
                    │
          ┌─────────┴─────────────────────┐
          │                               │
       FOUND                          NOT FOUND
          │                    ┌──────────┴──────────┐
   return PartyCard            │                     │
          │              email / phone           username
   attach to             (deliverable)        (not deliverable)
   trade                 │                     │
                    { found:false,          { found:false,
                      canInvite:true }        canInvite:false }
                               │                     │
                    create party_invitation,   prompt the user to
                    trade created in     supply an email or
                    PENDING_COUNTERPARTY,      phone instead
                    binds on claim
```

> A username miss cannot produce an invitation: `party_invitations` requires a deliverable destination (`otp_channel` is `SMS|EMAIL|WHATSAPP|VOICE`), and a handle that does not exist gives you nothing to send to. The client must fall back to asking for a contact channel.

### 8.2 The PartyCard — the only shape ever returned

```json
{
  "publicId": "KMT-U-7F3K9Q",
  "username": "janedoe",
  "displayName": "Jane D.",
  "avatarUrl": "https://cdn.kumtru.com/a/…",
  "verificationLevel": "BUSINESS_VERIFIED",
  "badges": ["EMAIL_VERIFIED", "PHONE_VERIFIED", "IDENTITY_VERIFIED",
             "BUSINESS_VERIFIED"],
  "memberSince": "2026-03-01",
  "completedTrades": 47,
  "isMerchant": true,
  "merchantName": "Jane's Gadgets"
}
```

`avatarUrl` is resolved from `avatar_file_id` through M20's signed-URL retrieval flow (D7) at the moment the PartyCard is built — never a cached or stored URL — so it is always short-lived and always reflects the current avatar.

`verificationLevel` is the scalar from `users.verification_level`. `badges` is a *separate display vocabulary* — `EMAIL_VERIFIED`, `PHONE_VERIFIED`, `IDENTITY_VERIFIED`, `BUSINESS_VERIFIED`, `ENHANCED_DUE_DILIGENCE` — and the levelled badges must be derived only from levels at or below `verificationLevel`. Never emit a badge implying a level the user has not attained; on a trust platform, an inconsistent badge set is worse than no badges.

Never returned by lookup, under any circumstance: email address, phone number, legal name, address, date of birth, bank details, current status detail, any KYC field. If ops needs those, that is an admin endpoint with `user.view_pii` permission and a mandatory audit entry.

### 8.3 Anti-enumeration controls

| # | Control |
|---|---|
| 1 | **Exact match only.** No prefix, fuzzy or partial search on email or phone. Ever. |
| 2 | **Authenticated + verified caller.** Requires `verification_level ≥ CONTACT_VERIFIED`. A fresh unverified account cannot mine the directory. |
| 3 | **Rate limits.** Username: 30/min, 300/day. Email/phone: 10/min, 50/day, 500/month — per user *and* per device *and* per IP. |
| 4 | **Constant-time response.** Found and not-found paths must take the same time. Pad with a dummy hash comparison; do not skip work on the miss path. |
| 5 | **Discovery flags respected.** If `discoverable_by_email = false`, an email lookup returns `found: false` — indistinguishable from a genuine miss. |
| 6 | **Velocity signal to Risk.** Every lookup emits `identity.party.lookup_performed`. A user performing 40 email lookups with 38 misses is scraping, and M13 should see it. |
| 7 | **Progressive friction.** After 20 consecutive misses in an hour, require a CAPTCHA; after 50, suspend lookup for 24h and open a fraud ticket. |
| 8 | **Suspended and closed users are invisible** to lookup, so lookup cannot be used to probe enforcement actions. |

### 8.4 Username autocomplete — a deliberate exception

Typeahead on `@` improves the tagging experience enormously and is the reason to have usernames at all. It is safe *only* because usernames are public by design, unlike emails. Constraints:

- Minimum 3 characters before any result.
- Prefix match only, never infix — infix search lets an attacker walk the whole namespace. Query as `lower(username::text) LIKE 'jan%'` so the expression index below is actually used; `ILIKE` on the `citext` column will not hit it.
- Maximum 8 results.
- Ranked by: prior counterparty with this user → shared merchant → completed trade count.
- Excluded: users with `discoverable_by_username = false`, and any user with zero completed trades and no verification (starves impersonation accounts of visibility).

```sql
-- Note: text_pattern_ops has no citext operator class, so index the folded
-- text form explicitly and query against the same expression.
CREATE INDEX users_username_prefix_idx
  ON users (lower(username::text) text_pattern_ops)
  WHERE status = 'ACTIVE' AND discoverable_by_username;

-- Matching query shape:
--   SELECT … FROM users
--   WHERE lower(username::text) LIKE $1 || '%'
--     AND status = 'ACTIVE' AND discoverable_by_username
--   LIMIT 8;
```

### 8.5 Invitation binding

When a tagged party does not exist, the trade must still be creatable — otherwise the seller abandons and you lose the trade. The invitation carries the context:

1. Seller tags `chidi@gmail.com`; no match.
2. `party_invitations` row created with `context_type='TRADE'`, `context_id=<trade>`, 14-day expiry.
3. Trade is created in `PENDING_COUNTERPARTY` (M7 owns this state).
4. Invitation is delivered with a signed claim link.
5. Chidi registers. On **verification of the invited channel** — not merely on clicking the link — the invitation is claimed and `identity.party_invitation.claimed` fires. M7 binds the trade.
6. **The invited channel must be the channel verified.** If Chidi registers with a different email, the invitation stays pending. This prevents a link-forwarding attack where the wrong person becomes the buyer.
7. Unclaimed after 14 days → status `EXPIRED`, `identity.party_invitation.expired` is emitted, M7 cancels the trade and Notifications tells the seller. The expiry event is not optional — without it M7 has no trigger and the trade hangs in `PENDING_COUNTERPARTY` forever.

---

## 9. State machines

### 9.1 User status

```
                        register
                            │
                            ▼
              ┌──── PENDING_VERIFICATION ────┐
              │             │                 │
   30d, no channel          │ FIRST channel   │ risk block
   verified                 │ verified        │ at signup
              │             │ (email OR phone)│
              ▼             ▼                 │
           CLOSED        ACTIVE               │
                            │                 │
        ┌───────────────────┼─────────────┐   │
        │                   │             │   │
   restrict            suspend       auto-lock│
        │                   │             │   │
        ▼                   ▼             ▼   │
   RESTRICTED           SUSPENDED ◀───────┘  LOCKED
        │  ▲                │  ▲                │
        │  │                │  │        self-recovery
        │  └── reinstate ───┼──┴────────  (OTP + MFA)
        │      (user.       │                   │
        │       reinstate)  │                   ▼
        │                   │                ACTIVE
        │                   │
        ├───────────────────┤
        │  escalate         │
        ▼                   ▼
   SUSPENDED            CLOSED ──30d / legal hold──▶ ANONYMISED
```

Reaching `ACTIVE` requires only the **first** verified channel — a phone-first user should be able to browse and be tagged immediately. Reaching `verification_level = CONTACT_VERIFIED` (level 1), which is what actually unlocks funding a trade, requires **both** channels. See §9.3.

| Status | Login | Browse | Buy | Sell | Withdraw |
|---|---|---|---|---|---|
| `PENDING_VERIFICATION` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `ACTIVE` | ✅ | ✅ | ✅ | ✅¹ | ✅¹ |
| `RESTRICTED` | ✅ | ✅ | ❌ | ❌ | ❌² |
| `SUSPENDED` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `LOCKED` | ❌³ | ❌ | ❌ | ❌ | ❌ |
| `CLOSED` | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ subject to `verification_level ≥ IDENTITY_VERIFIED` and active `SELLER` capability
² existing escrow obligations still settle — restriction stops new activity, it does not seize funds
³ recovery flow only

**Two distinct lockout mechanisms — do not conflate them.** `user_credentials.locked_until` is the automatic, self-clearing 15-minute throttle from §S5; the user's `status` stays `ACTIVE` throughout and no human is involved. `status = 'LOCKED'` is reserved for risk- or fraud-triggered locks that require the §S7 recovery flow (OTP plus an existing MFA factor, or an `account_recovery_requests` case if those are unavailable).

**Rule:** a status change never cancels in-flight escrow. Money already committed follows the trade state machine (M7) and the ledger (M8). Identity gates *new* actions only. Conflating the two is how you end up holding a buyer's money with no lawful path to release it.

### 9.2 Session lifecycle

```
  authenticate
       │
       ▼
   ACTIVE ──use refresh──▶ CONSUMED ──▶ new ACTIVE (same family_id)
       │                       │
       │                       └── replayed? ──▶ FAMILY REVOKED
       │                                          + risk event
       │                                          + notify user
       ├── idle_expires_at passed ────▶ EXPIRED
       ├── absolute_expires_at passed ─▶ EXPIRED
       ├── user logs out ─────────────▶ REVOKED
       ├── password changed ──────────▶ ALL OTHER SESSIONS REVOKED
       └── user suspended ────────────▶ (a) sessions_epoch++      → access
                                            tokens dead in ≤1 Redis TTL
                                        (b) revoked_at set on ALL sessions
                                        (c) /auth/refresh re-checks
                                            users.status and rejects

       (a) alone is not enough — without (b) and (c) the suspended user
       simply refreshes and receives a token stamped with the new epoch.
```

### 9.3 Registration

```
START
  │
  ├─▶ [Email path]  email + password ─▶ OTP to email ─▶ verified
  ├─▶ [Phone path]  phone ───────────▶ OTP to SMS ───▶ verified ─▶ set password
  └─▶ [Social path] OAuth ───────────▶ callback ─────▶ linked
  │
  ▼
CHOOSE USERNAME  ← blocking; cannot be skipped past first trade intent
  │
  ▼
SECOND CHANNEL   ← email users add phone, phone users add email
  │              ← required to reach CONTACT_VERIFIED
  ▼
ACTIVE (level 1) → can buy
  │
  └─▶ [optional] activate SELLER → M6 KYC → level 2 → can sell
```

---

## 10. API contracts

Base: `https://api.kumtru.com/v1`. All responses use RFC 9457 problem details for errors. All mutating endpoints accept `Idempotency-Key`.

### 10.1 Registration and authentication

```http
POST /auth/register
{
  "channel": "EMAIL",                 // EMAIL | PHONE
  "email": "jane@example.com",
  "phone": null,
  "password": "…",                    // optional on PHONE path
  "acceptedTermsVersion": "2026-08-01",
  "invitationToken": "…"              // optional, binds a party_invitation
}
→ 201 { "userId", "publicId", "status": "PENDING_VERIFICATION",
        "challengeId", "nextStep": "VERIFY_EMAIL" }
```

```http
POST /auth/verify-otp
{ "challengeId": "…", "code": "482913" }
→ 200 { "verified": true, "nextStep": "CHOOSE_USERNAME",
        "accessToken", "refreshToken", "expiresIn": 600 }
```

```http
POST /auth/login
{ "identifier": "jane@example.com | janedoe | +2348012345678",
  "password": "…", "deviceFingerprint": "…" }
→ 200 { "accessToken", "refreshToken", "expiresIn", "user": {…} }
→ 200 { "mfaRequired": true, "mfaToken": "…", "factors": [{"id","type","hint"}] }
→ 401 { "type": "…/invalid-credentials" }   // identical for every failure mode
```

> `identifier` accepts a username. This is convenient and safe *provided* the failure response is uniform — the same body, status and timing whether the user does not exist, the password is wrong, or the account is social-only.

```http
POST /auth/mfa/verify      { "mfaToken", "factorId", "code" }
POST /auth/refresh         { "refreshToken" }
POST /auth/logout          { "refreshToken", "allDevices": false }
POST /auth/password/forgot { "identifier" }        // always 202, always same shape
POST /auth/password/reset  { "resetToken", "newPassword" }
POST /auth/password/change { "currentPassword", "newPassword" }  // revokes others
```

### 10.2 Social

```http
GET  /auth/social/{provider}/authorize?redirectUri=…&state=…&mode=LOGIN|LINK
POST /auth/social/{provider}/callback   { "code", "state", "codeVerifier" }
→ 200 { "accessToken", "refreshToken", "isNewUser": true,
        "nextStep": "CHOOSE_USERNAME" }
→ 409 { "type": "…/link-requires-verification",
        "linkToken": "…", "maskedEmail": "j••••@gmail.com",
        "availableFactors": ["PASSWORD","EMAIL_OTP"] }

POST   /auth/social/{provider}/confirm-link  { "linkToken", "factorProof" }
GET    /me/social-identities
DELETE /me/social-identities/{provider}
```

PKCE is mandatory on all providers, including the web client. `state` is a signed, single-use, 10-minute nonce bound to the session.

### 10.3 Username

```http
GET  /usernames/availability?username=janedoe
→ 200 { "available": false, "reason": "CONFUSABLE_WITH_EXISTING",
        "suggestions": ["jane_doe_ng", "janedoe47", "jane.doe.lagos"] }

// reason ∈ INVALID_FORMAT | TOO_SHORT | TOO_LONG | RESERVED |
//          TAKEN | CONFUSABLE_WITH_EXISTING | QUARANTINED | BLOCKED_TERM

POST /me/username        { "username": "jane_doe_ng" }   // first claim
PATCH /me/username       { "username": "janes.gadgets", "reason": "…" }
→ 409 { "type": "…/username-change-blocked",
        "blockers": ["ACTIVE_TRADES"], "activeTradeCount": 2 }
GET  /me/username/history
```

`availability` is rate-limited at 20/min. Without that limit it is a free oracle for mapping the entire skeleton space.

### 10.4 Party lookup

```http
GET  /parties/lookup?username=janedoe
POST /parties/lookup     { "email": "jane@example.com" }
POST /parties/lookup     { "phone": "+2348012345678" }
→ 200 { "found": true,  "party": { …PartyCard… } }
→ 200 { "found": false, "canInvite": true, "maskedHint": null }
→ 429 { "type": "…/lookup-rate-limited", "retryAfter": 3600 }

GET  /parties/suggest?q=jan          // typeahead, ≥3 chars, prefix only, max 8
POST /parties/invite  { "channel": "EMAIL", "destination": "…",
                        "intendedRole": "BUYER",
                        "context": { "type": "TRADE", "id": "…" } }
```

### 10.5 Profile, capabilities, sessions, devices

```http
GET    /me
PATCH  /me/profile           // no longer accepts a raw avatarUrl field — D7
POST   /me/avatar            { "fileId" }   // fileId from M20's PROFILE_PHOTO upload flow
DELETE /me/avatar
GET    /me/emails            POST /me/emails         DELETE /me/emails/{id}
POST   /me/emails/{id}/verify         POST /me/emails/{id}/make-primary
GET    /me/phones            POST /me/phones         DELETE /me/phones/{id}
POST   /me/phones/{id}/verify         POST /me/phones/{id}/make-primary
PATCH  /me/privacy           { "discoverableByEmail": false }

POST   /me/capabilities/seller/activate
→ 202 { "status": "PENDING", "requires": ["IDENTITY_VERIFICATION","PAYOUT_ACCOUNT"] }
GET    /me/capabilities

GET    /me/sessions          DELETE /me/sessions/{id}   DELETE /me/sessions
GET    /me/devices           DELETE /me/devices/{id}    POST /me/devices/{id}/trust

GET    /me/mfa/factors
POST   /me/mfa/totp/enroll   → { "factorId", "secret", "otpauthUri" }
POST   /me/mfa/totp/activate { "factorId", "code" }
POST   /me/mfa/passkey/register/options
POST   /me/mfa/passkey/register/verify
DELETE /me/mfa/factors/{id}                  // step-up required
GET    /me/mfa/recovery-codes                // one-time display, 10 codes

POST   /me/close             { "reason", "password" }
POST   /me/data-export                       // NDPA portability
POST   /me/erasure-request                   // NDPA erasure
```

### 10.6 Admin

```http
GET    /admin/users?q=&status=&verificationLevel=&page=
GET    /admin/users/{id}                       // no PII unless permitted
GET    /admin/users/{id}/pii                   // user.view_pii + audited
POST   /admin/users/{id}/status  { "status": "SUSPENDED", "reason", "evidenceRef" }
POST   /admin/users/{id}/sessions/revoke-all
GET    /admin/users/{id}/audit-log
GET    /admin/users/{id}/linked-accounts       // shared device / IP / payout
POST   /admin/users/{id}/roles   { "roleCode", "reason", "expiresAt" }
DELETE /admin/users/{id}/roles/{roleCode}      { "reason" }
POST   /admin/usernames/reserve  { "username", "category", "note" }

// Two-step actions. Both write an admin_action_approvals row first; the
// execute call fails unless approved_by is set and differs from requested_by.
POST   /admin/users/{id}/mfa/reset/request         { "reason" }
POST   /admin/users/{id}/username/force-change/request
                                 { "newUsername", "reason", "evidenceRef" }
POST   /admin/approvals/{approvalId}/approve       { "reason" }
POST   /admin/approvals/{approvalId}/reject        { "reason" }
GET    /admin/approvals?status=PENDING
```

Every `/admin/*` call requires a `STAFF`-scoped session, an explicit permission, and writes an `identity_audit_log` row including the stated reason. A missing reason is a 400.

---

## 11. Domain events

Published to the platform event bus. Envelope: `{ eventId, eventType, version, occurredAt, correlationId, causationId, actor, payload }`. At-least-once delivery; consumers must be idempotent on `eventId`.

| Event | Payload highlights | Primary consumers |
|---|---|---|
| `identity.user.registered` | userId, publicId, registeredVia, ip | Notifications, Risk, Analytics, Referral |
| `identity.user.status_changed` | userId, from, to, reason, actor | Trades, Payments, Notifications, Audit |
| `identity.user.verification_level_changed` | userId, from, to | Merchants, Trades, Reputation |
| `identity.email.verified` | userId, emailId | Notifications, Trust |
| `identity.phone.verified` | userId, phoneId | Notifications, Trust, Risk |
| `identity.username.claimed` | userId, username | Search, Analytics |
| `identity.username.changed` | userId, from, to, reason | Search, Notifications, Audit, Trades |
| `identity.social_identity.linked` | userId, provider, wasAutoLinked | Notifications, Risk |
| `identity.social_identity.unlinked` | userId, provider | Notifications |
| `identity.credential.password_changed` | userId, viaRecovery | Notifications, Risk |
| `identity.session.created` | userId, sessionId, deviceId, ip, amr, isNewDevice | Risk, Notifications |
| `identity.session.reuse_detected` | userId, familyId, ip | **Risk (high priority)**, Notifications, Tickets |
| `identity.login.failed` | identifierHash, ip, reason | Risk |
| `identity.mfa.enrolled` / `.removed` | userId, factorType | Notifications, Risk |
| `identity.device.registered` | userId, deviceId, fingerprint, platform | Risk |
| `identity.capability.activated` | userId, capability | Merchants, Trades |
| `identity.admin_role.granted` / `.revoked` | userId, roleCode, grantedBy, expiresAt | Audit, Compliance |
| `identity.party.lookup_performed` | actorUserId, channel, found | Risk |
| `identity.party_invitation.created` | invitationId, inviterUserId, contextId | Notifications, Referral |
| `identity.party_invitation.claimed` | invitationId, claimedByUserId, contextId | **Trades**, Referral |
| `identity.party_invitation.expired` | invitationId, inviterUserId, contextId | **Trades**, Notifications |
| `identity.account.recovery_requested` | recoveryRequestId, userId, method | Risk, Tickets, Notifications |
| `identity.account.recovery_completed` | recoveryRequestId, userId, reviewedBy | Risk, Notifications, Audit |
| `identity.admin_action.approval_requested` | approvalId, action, subjectUserId | Notifications, Audit |
| `identity.account.erasure_requested` | userId, scheduledFor | Compliance, all domains |

Note `identity.session.reuse_detected` and `identity.account.recovery_requested` both auto-open tickets in M10. Account recovery is where social engineering lands; it should always have a human in the loop above a threshold.

---

## 12. RBAC baseline

### 12.1 Roles

| Role | Purpose | Dual approval to grant |
|---|---|---|
| `SUPER_ADMIN` | Break-glass. Two people maximum. | ✅ |
| `OPERATIONS_ADMIN` | Day-to-day trade and user operations | — |
| `FINANCE_ADMIN` | Refunds, settlement, reconciliation | ✅ |
| `COMPLIANCE_OFFICER` | NDPA, regulatory reporting, erasure approval | ✅ |
| `FRAUD_ANALYST` | Investigation, restriction, device graph | — |
| `KYC_ANALYST` | Verification review | — |
| `DISPUTE_REVIEWER` | Dispute decisions | — |
| `SUPPORT_AGENT` | Tickets, limited user view | — |
| `SUPPORT_LEAD` | Support + escalation + reassignment | — |
| `LOGISTICS_OPERATOR` | Shipment exceptions | — |
| `ANALYST` | Read-only analytics, no PII | — |
| `READ_ONLY` | Audit / observer | — |

### 12.2 Identity permissions

```
user.view                 user.view_pii             user.search
user.update               user.restrict             user.suspend
user.reinstate            user.close                user.impersonate
username.reserve          username.force_change
session.view              session.revoke
mfa.reset                 credential.force_reset
role.view                 role.grant                role.revoke
audit.view                audit.export
capability.grant          capability.revoke
```

### 12.3 Matrix — all 22 identity permissions × all 12 roles

Deny by default: a blank is a hard `❌`. Nothing is implicit, including for `SUPER_ADMIN`.

Columns: **SUP**=SUPER_ADMIN, **OPS**=OPERATIONS_ADMIN, **FIN**=FINANCE_ADMIN, **CMP**=COMPLIANCE_OFFICER, **FRD**=FRAUD_ANALYST, **KYC**=KYC_ANALYST, **DIS**=DISPUTE_REVIEWER, **SAG**=SUPPORT_AGENT, **SLD**=SUPPORT_LEAD, **LOG**=LOGISTICS_OPERATOR, **ANL**=ANALYST, **RDO**=READ_ONLY.

| Permission | SUP | OPS | FIN | CMP | FRD | KYC | DIS | SAG | SLD | LOG | ANL | RDO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `user.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `user.search` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `user.view_pii` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️¹ | ⚠️¹ | ❌ | ❌ | ❌ |
| `user.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user.restrict` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user.suspend` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user.reinstate` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user.close` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️⁴ | ❌ | ❌ | ❌ |
| `user.impersonate` | ✅² | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `username.reserve` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `username.force_change` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `session.view` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `session.revoke` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `mfa.reset` | ✅³ | ✅³ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️³ | ❌ | ❌ | ❌ |
| `credential.force_reset` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `capability.grant` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `capability.revoke` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `role.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| `role.grant` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `role.revoke` | ✅ | ❌ | ❌ | ✅⁵ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| `audit.export` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ Support sees masked PII by default. Unmasking requires an open ticket referencing that user, is time-boxed to the life of the ticket, and writes an audit row per field revealed.
² Impersonation ("view as user") is read-only, time-boxed to 15 minutes, banner-visible in the consumer UI, and blocked for any trade, payment or settings mutation.
³ `mfa.reset` is a two-step action via `admin_action_approvals`: holding the permission lets you *request* it; a different holder must approve, and an identity challenge with the user must be completed first.
⁴ `SUPPORT_LEAD` may close an account only on a documented user request in an open ticket.
⁵ `COMPLIANCE_OFFICER` may revoke roles but never grant them — this is the offboarding path, and it prevents compliance from escalating its own access.

**Note on `ANALYST` and `READ_ONLY`.** Neither holds `user.view_pii`. `ANALYST` should in practice work against the analytics warehouse (M16) with pseudonymised identifiers rather than these endpoints at all; the row exists so that the deny is explicit rather than accidental.

---

## 13. Build vs buy

You asked me to spec both. Here is the honest comparison, then a recommendation.

### 13.1 Cost at Kumtru's likely trajectory

Approximate monthly cost by monthly active users, list pricing:

| MAU | Auth0 B2C | Clerk | AWS Cognito | Supabase Auth | In-house |
|---|---|---|---|---|---|
| 5,000 | ~$0–150 | ~$25 | ~$0 (free tier) | ~$25 | infra only |
| 25,000 | ~$500–800 | ~$500 | ~$70 | ~$100 | infra only |
| 100,000 | ~$1,500–3,000 | ~$2,000+ | ~$300 | ~$400 | infra only |
| 500,000 | enterprise quote | enterprise quote | ~$1,500 | ~$1,800 | infra only |

Treat these as directional — pricing changes and every vendor negotiates. Verify before committing.

The naïve read is "in-house is free." It is not. In-house costs roughly 8–12 engineer-weeks for a production-grade first version, plus permanent ownership of a system where mistakes are breaches rather than bugs. The right comparison is *vendor fees* versus *engineering time + security liability*.

### 13.2 The argument that actually decides it

For most startups I would say buy, because auth is undifferentiated. For Kumtru, three things change the answer.

**NDPA cross-border transfer.** The Nigeria Data Protection Act 2023 restricts transfer of Nigerians' personal data abroad unless the destination provides adequate protection or a recognised safeguard applies, and Kumtru will almost certainly qualify as a **data controller of major importance** — the threshold is processing personal data of more than 200 data subjects in six months, and the designated sectors explicitly include Financial and E-Commerce. That brings mandatory NDPC registration, a Data Protection Officer, and documented justification for every cross-border data movement. Penalties reach ₦10 million or 2% of annual gross revenue, whichever is higher. Putting your entire user identity store in a US-hosted SaaS makes your *core* system the thing you must justify to a regulator, forever. Self-hosting in a region you control makes this a solved problem rather than a standing obligation.

**Identity is a fraud sensor, not a utility.** On an escrow platform, `identity.session.created` with a new device fingerprint at 3am from a new IP is a *risk signal about a trade*. Device graphs, shared-fingerprint clusters and login velocity are inputs to M13. With a vendor, those signals live behind an API, arrive late, and are shaped by someone else's schema. Owning them means Risk queries the same Postgres as everything else.

**Migration cost is asymmetric.** Moving off a vendor later means re-hashing passwords you cannot read, re-consenting every social link, and asking every user to reset. Doing it at 500k users is brutal. Starting in-house and moving *to* a vendor later is comparatively easy.

### 13.3 Recommendation

**Build in-house, on well-tested libraries, with the schema above.** Deliberately reject three things: writing your own crypto, writing your own OAuth client, and writing your own WebAuthn implementation. Those are the parts people get wrong.

```
Node 20+ / TypeScript
├── @node-rs/argon2       password hashing (argon2id, m=19456 t=2 p=1)
├── jose                  JWT sign/verify, JWKS, EdDSA
├── openid-client         certified OIDC/OAuth client — Google, Apple, Facebook
├── @simplewebauthn/server passkeys
├── otplib                TOTP
├── libphonenumber-js     E.164 normalisation
├── zod                   input validation at every boundary
├── unicode-confusables   skeleton generation (wrap it, version it, test it)
└── ioredis               rate limiting, OTP store, session epoch cache
```

Infrastructure: PostgreSQL 15+ as the sole source of truth, Redis for ephemeral state only, KMS-backed envelope encryption for `secret_enc` / `*_token_enc` / `destination_enc` columns. Never hold key material in application config.

### 13.4 If you buy anyway — the abstraction that keeps the door open

If the team is stretched thin at launch, the escape hatch is to keep the domain model above *exactly as specified* and treat the vendor as a credential store only:

```
        Kumtru owns                     Vendor owns
   ─────────────────────           ────────────────────
   users, username, profile        password hash
   capabilities, RBAC              OTP delivery
   verification_level              social OAuth handshake
   devices, party lookup           credential storage
   audit log, events
              │                              │
              └──────── external_auth_id ────┘
                       (one nullable column)
```

Add `users.external_auth_id text UNIQUE` and nothing else. The vendor authenticates; Kumtru authorises. Every business rule in this document still holds, and swapping the vendor is a migration of one column and a password-reset campaign rather than a rebuild.

**Do not** let a vendor own the `users` table, the username, or the role model. That is the version of "buy" that becomes unrecoverable.

---

## 14. Security requirements

| # | Requirement |
|---|---|
| S1 | Argon2id, `m=19456 KiB, t=2, p=1` minimum. Re-hash transparently on login when parameters change. |
| S2 | Password policy: minimum 10 characters, checked against a breach corpus via k-anonymity (HIBP range API — never send the full hash). No composition rules; length and breach-checking beat forced symbols. |
| S3 | Uniform authentication failures. Same status, same body, same timing across nonexistent user / wrong password / social-only account / locked account. |
| S4 | Rate limits: login 5/min/identifier + 20/min/IP; OTP send 3/10min/destination, 10/day; OTP verify 5 attempts per challenge; password reset 3/hour/identifier. |
| S5 | Account lockout: 10 failed attempts → 15-minute lock, exponential thereafter. Never permanent — permanent lockout is a denial-of-service vector against your own users. |
| S6 | OTP: 6 digits, cryptographically random, 5-minute TTL, single use, invalidated on new issuance for the same purpose+destination. Store HMAC only. |
| S7 | Step-up authentication required for: password change, email/phone change, MFA removal, payout account change, username change, social unlink, seller activation. |
| S8 | All tokens in mobile: iOS Keychain / Android Keystore. Web: refresh token in `HttpOnly; Secure; SameSite=Strict` cookie; access token in memory only, never `localStorage`. |
| S9 | Envelope encryption (KMS) for TOTP secrets, OAuth tokens, invitation destinations. Column-level, not just disk-level. |
| S10 | Every auth-sensitive action writes `identity_audit_log` before returning success. Audit failure fails the request. |
| S11 | Notify the user on every security-relevant event: new device login, password change, MFA change, social link, email/phone change. Send to the *old* address on change, not only the new one. |
| S12 | No PII in application logs. Log `user_id` and hashed identifiers. Emails, phones and tokens are prohibited in log output — enforce with a redacting serialiser, not a code-review convention. |
| S13 | Staff sessions: mandatory MFA, 30-minute idle TTL, no social login, optional IP allowlist for `FINANCE_ADMIN` and `SUPER_ADMIN`. |
| S14 | PKCE mandatory on every OAuth flow. `state` signed, single-use, 10-minute TTL, session-bound. |
| S15 | Device fingerprint is a *signal*, never an authenticator. It is spoofable. Never grant access on fingerprint alone. |

---

## 15. NDPA compliance hooks

| Obligation | Implementation |
|---|---|
| Lawful basis | `terms_version` and `privacy_version` captured at registration with timestamp and IP |
| Consent granularity | Separate opt-ins for marketing, and for discovery by email/phone. Transactional messaging is contractual necessity and not opt-out-able |
| Data subject access | `POST /me/data-export` → async job, signed download link, 30-day SLA |
| Erasure | `POST /me/erasure-request` → **anonymise, never delete.** Financial and dispute records must survive; personal identifiers are replaced |
| Rectification | Self-service on profile; identity fields require M6 re-verification |
| Portability | JSON export of profile, trades, reputation |
| Cross-border | Document every processor with a data-residency register. Prefer processors with African or EU regions. This is the single strongest reason to self-host identity |
| Retention | Audit log 7 years; sessions 90 days; OTP challenges 30 days; device records 2 years post-last-seen |
| Breach notification | Automated alerting from `identity.session.reuse_detected` clusters and anomalous `user.view_pii` volume |
| DPO | Named Data Protection Officer with access to `audit.export` |

### Anonymisation procedure

Run as a single database transaction after the retention and legal-hold period. Never a hard `DELETE` of the `users` row.

```sql
BEGIN;

-- 1. Permanently retire the real handle so it can never be re-claimed and
--    inherit the account's history. Do this BEFORE overwriting it.
INSERT INTO identity.reserved_usernames (username_skeleton, category, note)
SELECT username_skeleton, 'SYSTEM', 'retired by anonymisation'
FROM identity.users WHERE id = $1 AND username_skeleton IS NOT NULL
ON CONFLICT (username_skeleton) DO NOTHING;

-- 2. Replace identifiers. $2 is the tombstone handle produced by the
--    APPLICATION's skeleton() function — see note below.
UPDATE identity.users SET
  username          = $2,
  username_skeleton = $3,
  status            = 'ANONYMISED',
  anonymised_at     = now(),
  primary_email_id  = NULL,
  primary_phone_id  = NULL,
  sessions_epoch    = sessions_epoch + 1,   -- kills any live access token
  registration_ip   = NULL,
  consent_ip        = NULL,
  last_login_at     = NULL
WHERE id = $1;

-- 3. Destroy credentials, channels and authenticators.
DELETE FROM identity.user_emails         WHERE user_id = $1;
DELETE FROM identity.user_phones         WHERE user_id = $1;
DELETE FROM identity.social_identities   WHERE user_id = $1;
DELETE FROM identity.user_credentials    WHERE user_id = $1;
DELETE FROM identity.devices             WHERE user_id = $1;
DELETE FROM identity.passkey_credentials WHERE user_id = $1;
DELETE FROM identity.mfa_factors         WHERE user_id = $1;
DELETE FROM identity.otp_challenges      WHERE user_id = $1;
DELETE FROM identity.username_history    WHERE user_id = $1;

-- 4. Revoke every session outright, not just epoch-bump.
UPDATE identity.sessions
   SET revoked_at = now(), revoke_reason = 'ANONYMISED'
 WHERE user_id = $1 AND revoked_at IS NULL;

-- 5. Strip recoverable destinations from invitations this user sent.
UPDATE identity.party_invitations
   SET destination_enc = NULL, destination_masked = '•••'
 WHERE inviter_user_id = $1;

-- 6. Scrub the profile.
UPDATE identity.user_profiles SET
  display_name = 'Deleted User', first_name = NULL, last_name = NULL,
  avatar_file_id = NULL, bio = NULL, date_of_birth = NULL, gender = NULL
WHERE user_id = $1;

COMMIT;
```

Four points that are easy to get wrong:

- **Generate the tombstone handle through `skeleton()`, not by string concatenation.** Raw UUID hex contains `0`, `1`, `5` and repeated characters, which the §6.3 folder would rewrite; a hand-built skeleton can therefore collide with a legitimate user's folded skeleton and violate the `UNIQUE` constraint at the worst possible moment. Compute `username = 'deleted_' || <12 hex>` in the application, then set `username_skeleton = skeleton(username)`.
- **`identity_audit_log` is deliberately untouched.** It is the record of the erasure itself and is retained for seven years under the retention policy. It stores `user_id`, not personal data — which is exactly why §S12 forbids PII in log payloads.
- **The `users` row survives** so foreign keys from trades, disputes and ledger entries stay intact. Retired usernames are permanently reserved and never recycled.
- **Step 6 only clears this row's reference; it does not itself tombstone the M20 file.** The avatar file (like every other file this user uploaded) gets tombstoned separately through the existing `identity.account.erasure_requested` → M15 → `compliance.dsr_fulfilled` (type DELETE) → M20 chain (M20 §8), which finds it by `file_records.uploader_user_id`. No special-casing needed here — D7 only required the reference to exist as a proper soft ref, which is what makes it discoverable by that chain in the first place.

---

## 16. Package structure

```
packages/identity/
├── src/
│   ├── domain/
│   │   ├── user/            User aggregate, status machine, invariants
│   │   ├── username/        policy.ts, skeleton.ts, reserved.ts, suggest.ts
│   │   ├── credential/      hashing, policy, breach check
│   │   ├── session/         issuance, rotation, reuse detection
│   │   ├── social/          linking rules (the §7.4 decision tree, one file)
│   │   ├── capability/
│   │   ├── rbac/            role & permission resolution, SoD checks
│   │   └── invitation/
│   ├── application/         use-cases; one per API operation
│   ├── infrastructure/
│   │   ├── postgres/        repositories, migrations
│   │   ├── redis/           rate limiter, OTP store, epoch cache
│   │   ├── providers/       google.ts, apple.ts, facebook.ts (openid-client)
│   │   ├── crypto/          KMS envelope encryption, HMAC helpers
│   │   └── events/          publisher
│   ├── http/                routers, DTOs, zod schemas, error mapping
│   └── index.ts             ← the ONLY public surface
└── test/
    ├── unit/
    ├── integration/
    └── security/            enumeration, timing, rate limit, linking attacks
```

**Module boundary rule.** No other package imports from `identity/src/**` — only from `identity` (the index). Enforce with an ESLint `no-restricted-imports` rule in CI. This is what makes later extraction to a service a refactor instead of an archaeology project.

---

## 17. Test requirements

Beyond normal unit coverage, these are the tests that matter. Treat them as acceptance criteria.

### Username

- Skeleton collision: `dellstore`, `dell.store`, `dellst0re`, `de11st0re`, `dellstoree` — first wins, rest rejected. Assert the skeleton value is `delstoreng`-style (run-collapsed), not merely that a collision occurred.
- Every reserved word rejected, including confusable variants.
- Cooldown, lifetime cap, and active-trade block all enforced server-side.
- Quarantine prevents third-party claim for 90 days and permits owner reclaim for 30.
- Trade records retain the historical username after a change.
- Uppercase input (`JaneDoe`) rejected by the DB `CHECK`, not just by the application — proves the `::text` cast defeats citext case-folding.
- An anonymisation tombstone handle is generated through `skeleton()` and inserts cleanly with 10,000 pre-existing users present.

### Enumeration

- `POST /auth/login` response time variance between existing and nonexistent user < 5ms across 1,000 samples.
- `/auth/password/forgot` returns identical response for known and unknown identifiers.
- `/parties/lookup` returns identical shape and timing for miss and for `discoverable_by_email = false`.
- Rate limits trigger per user, per device and per IP independently.

### Social linking

- Unverified provider email never auto-links. (Test with a forged callback asserting `email_verified: false`.)
- Auto-link permitted only when the target account has *no* password, *no* other social identity, *no* passkey and *no* active MFA factor. Assert explicitly that a passkey-only account and a TOTP-only account both fall to the step-up path.
- Existing-factor account requires step-up; linking without it fails.
- No matching verified email → new user created with `isNewUser: true`, `verification_level = UNVERIFIED` and `username = NULL`.
- Apple first-callback email is persisted; second callback with no email does not null it out.
- Provider `sub` collision across two Kumtru users is impossible (unique index proven).

### Sessions

- Refresh rotation invalidates the prior token.
- Replay of a consumed token revokes the entire family and emits the risk event.
- Suspension kills all access tokens within one Redis TTL **and** `POST /auth/refresh` with a previously valid refresh token returns 401. This is the test that catches the epoch-only kill switch bug.
- Password change revokes all other sessions but not the current one.
- Staff scope cannot be obtained from a consumer refresh token.
- Anonymisation revokes all sessions and bumps `sessions_epoch`.

### RBAC

- Every permission denied by default; nothing implicit. Drive this from the §12.3 matrix as a table-driven test over all 22 × 12 cells so a new permission fails CI until it is placed.
- Self-dealing block: an admin cannot action a trade they are party to.
- Dual-approval roles cannot be granted by a single actor — verify the DB trigger fires, not just the service check.
- `approved_by = granted_by` and `granted_by = user_id` both rejected by CHECK constraint.
- `mfa.reset` and `username.force_change` cannot execute without an approved `admin_action_approvals` row from a different actor.
- Expired role assignments stop authorising at `expires_at` without a job run.
- Every admin action produces exactly one audit row with a non-empty reason.
- The application DB role cannot `UPDATE` or `DELETE` `identity_audit_log` — assert the trigger raises and that `kumtru_app` lacks the privilege.

---

## 18. Delivery plan

| Sprint | Deliverable | Definition of done |
|---|---|---|
| **1** | Schema, migrations, `users` aggregate, audit log, event publisher | Migrations run clean up and down; audit immutability proven at the DB role level |
| **2** | Email + phone registration, OTP, password login, session issue/refresh/revoke | Enumeration and timing tests pass |
| **3** | Username: format, skeleton, reserved list, claim, availability, suggestions | Full collision suite green; reserved list seeded |
| **4** | Google + Apple OAuth, the §7.4 linking decision tree, account linking UX | Linking attack suite green; Apple first-callback persistence verified |
| **5** | Party lookup, typeahead, invitations, claim-on-verify binding | Rate limits and constant-time responses verified under load |
| **6** | Devices, MFA (TOTP + SMS), passkeys, step-up, recovery codes | Step-up enforced on all §S7 actions |
| **7** | Capabilities, RBAC, staff login, admin endpoints, self-dealing block | RBAC matrix test suite green; all admin actions audited |
| **8** | Account lifecycle, recovery, NDPA export/erasure, hardening | External penetration test on identity endpoints passed |

Sprints 1–3 are hard prerequisites for M7 (Trades) — a trade cannot be created without a resolvable counterparty. Sprint 5 is a prerequisite for the seller-initiated trade flow, which is likely your primary funnel.

---

## 19. Decisions requiring your sign-off

| # | Decision | My recommendation |
|---|---|---|
| 1 | Build vs buy auth | **Build**, per §13.2 — NDPA cross-border exposure and fraud-signal ownership outweigh the engineering cost |
| 2 | Social providers at launch | **Google + Apple only.** Apple is mandatory on iOS once any social login exists |
| 3 | Instagram / X | **Not as login.** Instagram Basic Display is dead for personal accounts; X now bills per API read. Use both as *verified social proof* in M6 instead |
| 4 | Username required at signup | **Deferred but blocking** — required before first trade or seller activation |
| 5 | Username changeable | **Yes, with friction**: 30-day cooldown, 3 lifetime, blocked during active trades, 90-day quarantine |
| 6 | Discoverable by email default | **On.** Tagging is the product. Provide a clear off switch and hard rate limits |
| 7 | Staff on the same user object | **Yes**, with the six controls in §D2. Fluidity is right; unbounded fluidity is not |
| 8 | Primary datastore | **PostgreSQL 15+**, single instance to start, schema-per-module inside one database |
| 9 | Non-ASCII usernames | **Reject at launch.** Zero cost in Nigeria, removes the entire homoglyph class |
| 10 | ASCII-only skeleton versioning | **Version from day one**, grandfather on change, report-only mode before enforcement |
| 11 | Avatar storage | **Route through M20's `PROFILE_PHOTO` category** (D7) — `avatar_file_id` soft ref resolved to a signed URL at read time, never a raw stored URL. Confirmed 2026-08-23; a build requirement, not optional cleanup |

---

## 20. What I would specify next

In dependency order:

1. **Trust & Verification (M6)** — it gates seller capability, and the identity schema already references `verification_level`. Blocked on nothing.
2. **Trade Management (M7)** — the state machine is the spine of the platform, and it depends on party resolution from §8.
3. **Payment, Escrow & Ledger (M8)** — the double-entry model. This is the one where a design mistake is expensive and slow to unwind.
4. **Notifications (M11)** — a thin dependency for everything above; specify early so no module invents its own SMS sending.

M9 (Orders), M10 (Tickets), M12 (Reputation) and M13 (Risk) can follow once the spine exists.

---

## Sources

- [X (Twitter) API Pricing in 2026: All Tiers — Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)
- [How Much Does the X (Twitter) API Cost in 2026?](https://twitterapi.io/blog/x-api-cost-breakdown-2026)
- [Twitter/X API Pricing 2026: All Tiers Compared](https://www.xpoz.ai/blog/guides/understanding-twitter-api-pricing-tiers-and-alternatives/)
- [Log in with X — X Developer Docs](https://docs.x.com/fundamentals/authentication/guides/log-in-with-x)
- [Deprecation of the Instagram Basic Display API](https://lightwidget.com/basic-display-api-deprecation)
- [Instagram Basic Display API Deprecation — Phyllo](https://www.getphyllo.com/post/instagram-basic-display-api-deprecation-what-it-is-for-developers-and-businesses)
- [Meta shut down the Basic Display API — Behold](https://behold.so/updates/basic-display-api-deprecated/)
- [New requirement for apps using Sign in with Apple — Apple Developer News](https://developer.apple.com/news/?id=j9zukcr6)
- [New Guidelines for Sign in with Apple — Apple Developer News](https://developer.apple.com/news/?id=09122019b)
- [Understanding the Nigeria Data Protection Act, 2023](https://cookie-script.com/privacy-laws/nigeria-data-protection-act-2023)
- [Nigeria's Cross-Border Data Transfer Regulation — ITIF](https://itif.org/publications/2025/06/09/nigeria-cross-border-data-transfer-regulation/)
- [Cross-Border Data Transfers Under Nigeria's NDPA — Afriwise](https://www.afriwise.com/blog/cross-border-data-transfers-under-nigerias-ndpa-implications-for-u-s-saas-providers)
