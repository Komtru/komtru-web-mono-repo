# Kumtru — Module 0: Infrastructure & Environment Setup

**Implementation specification**
Version 0.1 · 18 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This is the account/service checklist and environment contract that every other module assumes exists. Read this before provisioning anything, and before Module 1 (Identity) can actually be built — its schema already assumes KMS-backed envelope encryption, a Redis-backed session kill switch, and an OTP delivery channel.

Two rules govern the choices below:

1. **One cloud for compute and data, an additional vendor only where it earns its keep for a single, genuine reason.** AWS hosts everything stateful except file storage. Google Cloud exists solely to issue OAuth credentials for "Sign in with Google" — nothing else lives there. Cloudinary is the second earned exception (added 2026-08-23): five independent free-tier accounts give this MVP five separate storage ceilings instead of one S3 bucket's ceiling, at zero cost — see Module 20 §2 D5-D7 for the full reasoning and the pooling/rotation design.
2. **Free where free is real, paid where the module spec requires it.** Some of Module 1's requirements (KMS envelope encryption, a durable job queue) aren't optional extras — they're already load-bearing in the schema. We pick the cheapest service that satisfies them, not the cheapest service that ignores them.

---

## 1. Cloud provider decision

| Concern | Provider | Why |
|---|---|---|
| Compute, database, secrets, encryption | **AWS** | Free-tier is more generous pre-revenue; single-vendor billing and IAM; AWS Secrets Manager/KMS/RDS compose cleanly |
| File/object storage | **Cloudinary** (5 free-tier accounts) | No AWS storage dependency at MVP — five accounts pooled by purpose and rotated, see Module 20 §2 D5-D7 |
| Sign in with Google (OAuth only) | **Google Cloud** | Required to issue the OAuth client used in Module 1 §7.1. No compute, DB, or storage should live here. |
| Sign in with Apple | **Apple Developer Program** | Mandatory once any social login exists (App Store Guideline 4.8), per Module 1 §7.1 |

Do not let Google Cloud creep beyond the OAuth consent screen and client credentials. If a second GCP resource shows up later (e.g., FCM technically routes through a Firebase/GCP project), that's fine — it's still a single-purpose dependency, not a second compute environment.

---

## 2. Service map

| Concern | Service | Launch tier | Notes |
|---|---|---|---|
| Version control | GitHub (private) | Free | Monorepo: `apps/`, `packages/` per the original blueprint. Branch protection + required review from day one. |
| Relational DB | **AWS RDS for PostgreSQL 15+** | `db.t4g.micro`, free tier (12 months) | Version pin matters — Module 1's composite FK syntax (`ON DELETE SET NULL (column)`) requires PG 15+. Plan the upgrade off free tier *before* real money moves through escrow, not after. |
| Object/file storage | **Cloudinary** (5 free-tier accounts) | Free tier per account | 1 dedicated account for profile photos, 1 dedicated for chat attachments, 3 pooled + rotated for every trade-related asset (KYC documents, dispute evidence, proof of delivery, listing images, ticket attachments, other). Every upload is Cloudinary's `authenticated` type — never publicly readable. See Module 20 §2 D5-D7, §5-§6. |
| App secrets (API keys, DB creds) | **Environment variables** (per-environment, not committed) | Free | No managed secrets service for MVP — scrapped in favor of plain env vars. See §2a for the trade-off and upgrade trigger. |
| Encryption keys | **Environment variable** (`ENCRYPTION_MASTER_KEY`, app-level AES-256-GCM) | Free | Backs `secret_enc`, `access_token_enc`, `refresh_token_enc` (Module 1 §5.6, §5.8). Not KMS-grade key custody — see §2a. |
| Cache / rate limit / session epoch | **Redis Cloud free tier** (30MB) | Free | Backs the `sessions_epoch` kill switch (Module 1 §D5) and OTP rate limiting. |
| Background jobs / crons | **BullMQ** on the same Redis instance | Free | See §4 and §5. |
| Domain events (in-process) | Node `EventEmitter` / typed event bus | Free, no infra | See §4. |
| OAuth — Google | Google Cloud project, OAuth consent screen only | Free | |
| OAuth — Apple | Apple Developer Program | $99/yr | Mandatory, not deferrable, once social login ships. |
| SMS / WhatsApp / Voice OTP | Termii or Africa's Talking | Pay-per-send | Nigeria-optimized deliverability beats Twilio here. |
| Transactional email | **Mailjet** (existing account) | User's existing plan | Already have this account — no new provider to stand up. Needs sending domain verification (SPF/DKIM) for the Kumtru domain specifically. |
| Push notifications | FCM (Android) + APNs (iOS) | Free | `devices.push_token` already in schema. |
| CI/CD | GitHub Actions | Free tier | |
| Error tracking | Sentry | Free tier | |
| IaC | Terraform | — | Introduce once resource count exceeds ~3-4 AWS services; not needed for the first provisioning pass. |

---

## 2a. MVP trade-off: environment variables instead of KMS/Secrets Manager

Documented explicitly, because this is a real security trade-off, not just a cost-saving default.

Module 1's schema requires envelope encryption for `secret_enc` (TOTP seeds) and `access_token_enc`/`refresh_token_enc` (social tokens). For MVP, that encryption happens in application code with a symmetric key (AES-256-GCM) read from an `ENCRYPTION_MASTER_KEY` environment variable, instead of calling out to AWS KMS per operation. Application-level secrets (API keys, DB credentials) are likewise plain environment variables, not Secrets Manager entries.

**What this gives up versus KMS/Secrets Manager:**

- Key custody is no longer separated from the application. Anyone with access to the running environment's env vars — a compromised server, a leaked deploy config, an over-permissioned CI job — can decrypt every protected row, not just exfiltrate ciphertext.
- No built-in audit trail of who/what decrypted a value and when. KMS logs every `Decrypt` call to CloudTrail; an env-var key has no equivalent.
- No native key rotation. Rotating means re-encrypting every affected row and redeploying with a new key, coordinated by hand.

**Why it's acceptable right now:** no real trade volume yet, no live NIN/BVN handling (that's explicitly Module 6's domain and out of scope here — Module 1 §1), and the blast radius of a leak today is TOTP seeds and OAuth tokens for a small pre-launch user base, not payment credentials.

**Concrete upgrade trigger — move to AWS KMS before any of these become true:**

- Real user funds start moving through escrow (i.e., before Module 8 / Payment & Ledger goes live in production)
- User count grows past what you'd comfortably hand-notify in a breach
- Any compliance review (NDPA, a payment partner's security questionnaire) asks how encryption keys are managed

**Practical setup now:** generate the key once (`openssl rand -base64 32`), set it in each environment's env var config via your host's secrets UI or GitHub Actions secrets — never in a committed `.env` file — and version it (a `key_version` column or ciphertext prefix) from day one, so a future rotation to KMS doesn't require a flag-day migration.

---

## 3. AWS account structure

A single AWS account is fine at MVP stage — do **not** default to multi-account complexity before there's a team to justify it. But set these up on day one, because retrofitting IAM discipline onto a live database is painful:

- No application ever authenticates with a root or personal IAM user's long-lived keys. Create a scoped IAM role/user for the app (`kumtru-app`) with least-privilege policies (RDS connect only — no S3, SSM, or KMS grants needed at MVP, see §2a and Module 20 §2 D5).
- A separate IAM identity for Terraform/infra changes, distinct from the app runtime identity.
- A **billing budget alarm** (AWS Budgets, free) at a low threshold (e.g., $20). This is cheap insurance — free-tier RDS usage caps are easy to blow through accidentally, and you want an email before AWS tells you with an invoice.
- Database-level: the app connects as a dedicated Postgres role (`kumtru_app`), never as the RDS master user — this is required for the audit-log immutability trigger in Module 1 §5.11 to actually mean anything (if the app can `ALTER TABLE`, the audit log is decorative, per that spec's own note).

---

## 4. Notifications: event emitter vs. message queue

Given the monolith-first architecture, an in-process event emitter is the right MVP choice for propagating domain events between modules (Trade → Notification, Trade → Audit, etc.). It costs nothing and matches "one deployable, clear domain boundaries."

The gap: a plain `EventEmitter` is synchronous and lives only in process memory. If the process crashes between `emit()` and a handler finishing, that event — and anything it was supposed to trigger — is simply gone. No retry, no record, no way to know it happened.

**Rule: split by what the handler does.**

```
Domain event occurs (e.g. TradeFunded)
        │
        ▼
  EventEmitter.emit()  ── free, in-process, synchronous
        │
        ▼
  Handler decides:
        │
        ├── Pure in-process work (update a cached counter,
        │   trigger another in-process module)
        │       → do it inline, in the handler. Fine to lose
        │         on crash — it's recomputable.
        │
        └── Any external I/O (send OTP SMS, send email,
            push notification, call a KYC provider, webhook)
                → do NOT do this inline.
                → enqueue a BullMQ job instead.
                → BullMQ job is durable (lives in Redis),
                  retries with backoff, and lands in a
                  dead-letter queue on repeated failure.
```

This defers a real message broker (SQS, Pub/Sub, Kafka) until you either extract services out of the monolith or need genuine cross-process delivery — both explicitly "later" problems per the original blueprint's own warning against premature microservices.

---

## 5. Cron / scheduled jobs

BullMQ's repeatable jobs cover every scheduled task the current specs require — no separate cron infrastructure (e.g., no EventBridge Scheduler) needed yet:

- `user_phones.reverify_after` sweep — force re-verification of stale phone bindings (Module 1 §D4, SIM-recycling defence)
- `otp_challenges` expiry cleanup
- `sessions` absolute-expiry sweep
- `admin_role_assignments.expires_at` expiry checks (role grants are time-boxed by default, Module 1 §D2/C6)
- `account_recovery_requests` SLA/staleness reminders

All run as BullMQ repeatable jobs against the same Redis instance as the queues in §4.

---

## 6. Redis: one instance, three jobs (for now)

The single free-tier Redis instance carries:

1. Session-epoch cache backing the kill switch (Module 1 §D5)
2. OTP / login rate limiting
3. BullMQ queues (jobs + repeatable crons, §4–§5)

**Free-tier caveat that actually matters:** BullMQ needs blocking commands (`BLMPOP`/`BRPOPLPUSH`) over a persistent TCP connection. Not every "free Redis" supports that cleanly:

| Provider | Verdict |
|---|---|
| **Redis Cloud (Redis Labs) free tier — 30MB** | **Recommended.** Standard TCP Redis, BullMQ works without workarounds. |
| Upstash | Serverless/REST-first; works with BullMQ but has had connection-limit and blocking-command caveats on the free tier historically — check current limits before committing if you go this route. |
| AWS ElastiCache | No meaningful free tier for this use case. Skip for now. |

**Flag for later, not now:** once real trade volume hits, split the BullMQ queue Redis from the session/rate-limit Redis — a job backlog shouldn't be able to degrade login latency for every user. Not a launch-day concern.

---

## 7. Environment variable checklist

Grouped by what each module needs. Values live in per-environment environment variables
(§2a), never a committed file — this is the shape of what gets pulled at boot:

```
# Database
DATABASE_URL
DATABASE_APP_ROLE          # kumtru_app, never the RDS master user

# Redis
REDIS_URL

# AWS
AWS_REGION
ENCRYPTION_MASTER_KEY        # AES-256-GCM key, base64 — for secret_enc/access_token_enc cols, §2a
ENCRYPTION_KEY_VERSION       # increments on rotation

# Cloudinary (Module 20 storage pools — 5 accounts, 3 vars each)
CLOUDINARY_PROFILE_CLOUD_NAME
CLOUDINARY_PROFILE_API_KEY
CLOUDINARY_PROFILE_API_SECRET
CLOUDINARY_CHAT_CLOUD_NAME
CLOUDINARY_CHAT_API_KEY
CLOUDINARY_CHAT_API_SECRET
CLOUDINARY_TRADE_1_CLOUD_NAME
CLOUDINARY_TRADE_1_API_KEY
CLOUDINARY_TRADE_1_API_SECRET
CLOUDINARY_TRADE_2_CLOUD_NAME
CLOUDINARY_TRADE_2_API_KEY
CLOUDINARY_TRADE_2_API_SECRET
CLOUDINARY_TRADE_3_CLOUD_NAME
CLOUDINARY_TRADE_3_API_KEY
CLOUDINARY_TRADE_3_API_SECRET

# Auth (Module 1)
JWT_SIGNING_PRIVATE_KEY      # Ed25519 private key, base64 — env var for MVP, see §2a
JWT_JWKS_URL
SESSION_EPOCH_TTL_SECONDS

# OAuth — Google
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET

# OAuth — Apple
APPLE_SERVICES_ID
APPLE_TEAM_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY            # base64-encoded .p8 key content, env var for MVP

# OTP / SMS
OTP_SMS_PROVIDER            # termii | africastalking
OTP_SMS_API_KEY

# Email
MAILJET_API_KEY
MAILJET_API_SECRET
MAILJET_FROM_ADDRESS
MAILJET_FROM_NAME

# Push
FCM_SERVER_KEY
APNS_KEY_REF

# Observability
SENTRY_DSN
```

These are raw values in env vars for MVP, not KMS/Secrets Manager references — deliberately, per §2a. They still must never be committed to a repo: set them through your host's environment-variable/secrets UI (or GitHub Actions secrets for CI), not in a tracked `.env` file.

---

## 8. Account setup checklist (do in this order)

1. AWS account → billing budget alarm → IAM structure (`kumtru-app` role, infra/Terraform role)
2. AWS RDS Postgres 15+ instance
3. Cloudinary — create 5 free-tier accounts (profile, chat, trade-1, trade-2, trade-3), record each account's cloud name/API key/API secret into the env vars above — see Module 20 §2 D5
4. Generate `ENCRYPTION_MASTER_KEY` (`openssl rand -base64 32`) and set it as an environment variable in every environment — see §2a
5. Redis Cloud free instance
6. GitHub repo → branch protection → Actions
7. Google Cloud project → OAuth consent screen → Sign in with Google credentials
8. Apple Developer Program enrollment → Services ID → Sign in with Apple
9. Termii or Africa's Talking account (SMS OTP)
10. Mailjet — verify Kumtru's sending domain (SPF/DKIM), generate API key/secret
11. Sentry project

---

## 9. Explicitly deferred

- AWS KMS / a managed secrets service — deliberately scrapped for MVP in favor of env vars; see §2a for the exact trigger to bring it back
- AWS S3 for object storage — not needed at MVP now that Cloudinary's free-tier accounts cover it (Module 20 §2 D5-D7); revisit only if a future compliance need specifically requires AWS-native storage
- A real message broker beyond the in-process event emitter (§4) — revisit when services get extracted from the monolith
- Search engine (Elasticsearch/Meilisearch) — blueprint already marks this "later"
- CDN as a distinct layer — cloud provider's default edge is adequate at MVP scale
- Analytics warehouse
- Terraform / IaC — introduce once the manual AWS console setup becomes error-prone to repeat
- Multi-account AWS structure, multi-region

---

## 10. Cost reality check

Not everything above is free — being upfront about what isn't, so budget surprises don't happen:

| Item | Cost |
|---|---|
| RDS `db.t4g.micro` | Free for 12 months, then ~$12-15/mo |
| Cloudinary (×5 accounts) | Free across all 5 within each account's free-tier credits; a `NEAR_QUOTA`/`DISABLED` account (Module 20 §2 D6) is the signal to provision a 6th free account, not to pay |
| Encryption key / app secrets (env vars) | Free — see §2a for what this trades away |
| Redis Cloud free tier | Free (30MB cap) |
| Apple Developer Program | $99/year, fixed |
| Mailjet | Existing account — no new marginal cost, but confirm the plan's send volume covers OTP/notification email traffic as it grows |
| Termii/Africa's Talking | Pay-per-SMS, no free tier — budget this against expected OTP volume |
| Sentry, GitHub, GCP OAuth | Free at this scale |

The one line item worth planning for explicitly is SMS OTP volume — it's the only per-trade cost in this list that scales directly with signups and logins.
