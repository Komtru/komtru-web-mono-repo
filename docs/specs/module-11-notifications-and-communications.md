# Kumtru — Module 11: Notifications & Communications

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Every module written so far — Identity (M1), Trust & Verification (M6), Trade Management (M7), Payment & Ledger (M8) — has emitted events assuming this module exists to catch them. This is that module. It's intentionally thin: the hard problems (what message, to whom, when) are decided by the modules emitting events; this module's job is *delivering* reliably across channels, not deciding content.

The rule the original architecture blueprint stated directly, and the one this whole module exists to enforce: **don't let every module independently send emails and SMS.** One service, one delivery-guarantee model, one place to see "did this user actually get told."

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Event-to-notification mapping | Which domain event triggers which template, on which channel(s) |
| Channel delivery | Push (FCM/APNs), Email (Mailjet), SMS/WhatsApp/Voice (Termii or Africa's Talking, per Module 0) |
| Templates | Versioned, localized message content, separate from code |
| User preferences | Opt-out for non-critical categories; hard opt-out floor for security-class messages |
| Delivery tracking and retry | At-least-once delivery via BullMQ, dead-letter queue for repeated failure |
| Rate limiting | Per-user caps so one noisy event stream can't spam a user |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Identity & Access (M1) | Device/push-token registry (`devices.push_token`) — M11 reads it, doesn't own it |
| Any domain module | Deciding *that* something happened and *that* it's notification-worthy — M11 only decides *how* to deliver a notification it's been told to send |
| Configuration (M17) | The actual template content library and per-category defaults, once that module exists — M11 owns the delivery mechanism and the schema template content lives in |
| Tickets (M10) | In-app support conversations — M11 delivers the "you have a new ticket reply" push, not the conversation itself |

> **Boundary note:** M11 never decides content. If a module wants a new notification, it defines a new template and fires an event — it does not call an ad-hoc "send this exact string" endpoint. That constraint is what keeps every notification traceable to the event that caused it, which matters the day someone asks "why did this user get this message."

---

## 2. Core design decisions

### D1 — Every send traces to a domain event, no exceptions

`notifications.event_name` is `NOT NULL`. There is no code path that sends a message without an event behind it — even an admin-triggered one-off message goes through a synthetic `admin.manual_notification_sent` event, so the audit trail (§6) never has a gap.

### D2 — Security-class notifications cannot be opted out of

OTP delivery, session-reuse alerts, account-recovery confirmations — these are marked `is_security_critical` on their template and bypass `notification_preferences` entirely. Everything else respects the user's opt-out. This mirrors M1's own drawn line between authentication (never optional) and everything else.

### D3 — At-least-once delivery, dead-letter after N failures

Per Module 0 §4: the event itself is emitted in-process (free, synchronous), but the actual send is a BullMQ job (durable, retryable). A job retries with exponential backoff up to a per-channel limit (default 5 attempts), then lands in a dead-letter state visible to ops rather than silently vanishing. A failed OTP send is not something that should ever fail silently — see §5.

### D4 — One notification can fan out to multiple channels, but channels don't cascade automatically

A template declares its channel(s) explicitly (e.g. OTP is SMS *and* push if the user has a session, never email — too slow). There's no automatic "push failed, so fall back to email" logic in v1; that's a real feature worth having eventually; it's also exactly the kind of implicit behavior that turns into a support mystery ("why did I get five emails") if it's built before there's a clear per-template fallback policy. Static per-template channel lists are the honest v1.

### D5 — Templates are data, not code

`notification_templates` holds subject/body content per locale and version. Shipping a copy change is a data update, not a deploy. This module owns the delivery-template schema even though the long-term home for the *content authoring* workflow is Configuration (M17, not yet specced) — M11's schema is written so M17 can plug a management UI on top later without a schema change.

---

## 3. Entity model

```
                event bus (all modules)
                        │
                        ▼
         notification_event_mappings
          (event_name → template_key)
                        │
                        ▼
              notification_templates
             (channel, content, locale)
                        │
                        ▼
                  notifications
             (one row per attempted send)
                        │
                        ▼
        notification_delivery_attempts
              (retry history, append)

Standalone: notification_preferences   notification_rate_limits
```

---

## 4. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS notify;
SET search_path TO notify, public;
```

### 4.1 Enumerations

```sql
CREATE TYPE notification_channel AS ENUM (
  'PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP'
);

CREATE TYPE notification_status AS ENUM (
  'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTERED', 'SUPPRESSED'
);

CREATE TYPE notification_category AS ENUM (
  'SECURITY', 'TRADE', 'PAYMENT', 'DISPUTE', 'TICKET',
  'MARKETING', 'ACCOUNT'
);
```

### 4.2 Templates and event mapping

```sql
CREATE TABLE notification_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key          text NOT NULL,
  channel               notification_channel NOT NULL,
  category              notification_category NOT NULL,
  locale                text NOT NULL DEFAULT 'en-NG',
  version               integer NOT NULL DEFAULT 1,
  subject               text,   -- null for SMS/push
  body                  text NOT NULL,
  is_security_critical  boolean NOT NULL DEFAULT false,   -- D2
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notification_templates_key_channel_locale
  ON notification_templates (template_key, channel, locale, version);
CREATE INDEX notification_templates_active_idx
  ON notification_templates (template_key) WHERE active;

CREATE TABLE notification_event_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name    text NOT NULL,   -- e.g. 'trade.funded'
  template_key  text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_event_mappings_event_idx
  ON notification_event_mappings (event_name) WHERE enabled;
```

### 4.3 Notifications and delivery attempts

```sql
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,   -- soft ref to identity.users(id)
  event_name      text NOT NULL,   -- D1: never null
  template_key    text NOT NULL,
  channel         notification_channel NOT NULL,
  category        notification_category NOT NULL,
  status          notification_status NOT NULL DEFAULT 'QUEUED',
  rendered_subject text,
  rendered_body    text NOT NULL,
  provider_reference text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  failed_reason   text,
  correlation_id  uuid   -- ties multi-channel fan-outs from one event together
);

CREATE INDEX notifications_user_idx ON notifications (user_id, queued_at DESC);
CREATE INDEX notifications_status_idx ON notifications (status)
  WHERE status IN ('QUEUED', 'SENDING', 'FAILED');
CREATE INDEX notifications_correlation_idx ON notifications (correlation_id);

CREATE TABLE notification_delivery_attempts (
  id              bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt_number  integer NOT NULL,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  succeeded       boolean NOT NULL,
  error_detail    text
);

CREATE INDEX notification_delivery_attempts_notif_idx
  ON notification_delivery_attempts (notification_id);
```

### 4.4 Preferences and rate limiting

```sql
CREATE TABLE notification_preferences (
  user_id     uuid NOT NULL,
  category    notification_category NOT NULL,
  channel     notification_channel NOT NULL,
  opted_in    boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE notification_rate_limits (
  user_id           uuid NOT NULL,
  channel           notification_channel NOT NULL,
  window_started_at timestamptz NOT NULL,
  send_count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel, window_started_at)
);
```

---

## 5. Delivery flow

```
Domain event fires (e.g. trade.funded)
        │
        ▼
notification_event_mappings lookup — which template_key(s)?
        │
        ▼
For each mapped template:
        │
        ├─ is_security_critical?  ──YES──▶ skip preference check
        │                                  (D2)
        └─ NO ──▶ check notification_preferences
                   for (user, category, channel)
                          │
                     opted out? ──YES──▶ status = SUPPRESSED, stop
                          │
                          NO
                          ▼
                  check notification_rate_limits
                          │
                    over cap? ──YES──▶ status = SUPPRESSED
                          │             (except SECURITY category,
                          │              which is never rate-limited)
                          NO
                          ▼
                  render template, enqueue BullMQ job
                          │
                          ▼
                  provider adapter sends (Mailjet/Termii-
                  Africa's Talking/FCM/APNs per channel)
                          │
                    ┌─────┴─────┐
                    │           │
                success       failure
                    │           │
                    ▼           ▼
              status=SENT   retry with backoff (D3)
                              (max 5 attempts, default)
                                  │
                            still failing?
                                  │
                                  ▼
                        status=DEAD_LETTERED,
                        emit notification.dead_lettered
                        → ops alert; if category=SECURITY,
                        auto-opens a ticket (M10) — a user
                        who can't get their OTP is a user
                        who's about to get locked out
```

---

## 6. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `notification.sent` | notificationId, userId, channel | Analytics (M16, once specced) |
| `notification.failed` | notificationId, channel, reason | Ops alerting |
| `notification.dead_lettered` | notificationId, userId, category | Ops alerting; Tickets (M10) if `SECURITY` |

Note the direction here is inverted from every other module's events section: M11 mostly *consumes* everyone else's events rather than emitting ones others act on. The handful above exist mainly for observability, not for driving further business logic.

---

## 7. API surface

```
GET    /notifications                    a user's own notification history (IN_APP feed)
POST   /notifications/:id/mark-read
GET    /notification-preferences
PUT    /notification-preferences         update opt-in/out per category+channel

# Admin
GET    /admin/notifications/dead-letter
POST   /admin/notifications/:id/retry
GET    /admin/notification-templates
PUT    /admin/notification-templates/:key   creates a new version, per D5
```

---

## 8. What I would specify next

Per M1 §20's original four (M6, M7, M8, M11 — now all four done), the natural continuation is the group M1 §20 flagged as able to "follow once the spine exists": **Orders (M9)** next, since Trade Management (M7) already has an `order_id` placeholder waiting on it, followed by **Tickets (M10)**, **Reputation (M12)**, and **Risk & Fraud (M13)**.
