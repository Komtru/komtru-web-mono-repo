# T-039 — Account lifecycle, recovery and NDPA hooks: implementation plan

**Ticket:** `docs/tickets/03-identity.md` T-039. **Specs:** M1 §9.1 (status machine), §10.5 (`/me/close`, `/me/data-export`,
`/me/erasure-request`), §11 (events), §15 (NDPA, anonymisation). **No migration** is needed: `users.status`, `closed_at`,
`anonymised_at`, `account_recovery_requests` and `reserved_usernames` already exist from T-030.

## Shape

Three services, one pure domain file, three ports.

| Piece                           | Responsibility                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/lifecycle.ts`           | The §9.1 transition table as data: who (`STAFF`, `SYSTEM`, `SELF`) may move `from` to `to`, and which RBAC permission staff need. Pure, unit-tested exhaustively (every pair of the 7x7 matrix).                                                                                                                                               |
| `services/lifecycle.service.ts` | `applyStatusTransition(tx, …)` — the one write path for `users.status`: row lock, table check, kill switch when the target cannot hold a session, `identity.user.status_changed`, audit. `changeUserStatus` (T-037) delegates to it. `closeOwnAccount`, `lockAccount` (risk), `sweepAbandonedRegistrations`, `getAccountNotice` (AS1/AS2).     |
| `services/recovery.service.ts`  | `requestRecovery` (public intake, risk score, human-review flag, emits `identity.account.recovery_requested` which M10 turns into a ticket), staff `listRecoveryRequests`, `decideRecovery` (approve/reject, reviewer is never the subject, approval unlocks a LOCKED account, revokes sessions, emits `identity.account.recovery_completed`). |
| `services/ndpa.service.ts`      | `requestDataExport`, `requestErasure` (closes the account, then hands off with `identity.account.erasure_requested`), and `anonymiseUser`, the M1 §15 procedure as one transaction that calls `anonymiseUserAddresses(tx, userId)` and, after commit, asks the files port to tombstone the user's uploads (avatar included).                   |

Ports (injected through `IdentityAuthOptions`, wired in `modules/index.ts`, because identity cannot import trades or files — both import identity):

- `hasActiveTrades(db, userId)` — wired to trades. **Absent means "yes"** (fail closed): closing is refused rather than allowed blind.
- `tombstoneUserFiles(userId, reason)` — wired to files' `tombstoneByUploader`. Absent: logged, and the post-commit `identity.account.anonymised` event is the retry hook.

Routes: `GET /me`, `POST /me/close`, `POST /me/data-export`, `POST /me/erasure-request`, `POST /auth/recovery-requests` (public),
`GET /admin/recovery-requests`, `POST /admin/recovery-requests/:id/decision`. `POST /admin/users/:id/status` additionally accepts `CLOSED`.

T-104 (compliance) and T-100 (support) are not built: every hand-off is an outbox event and nothing more.

## Status machine (M1 §9.1)

| From                 | To         | By                                                                          |
| -------------------- | ---------- | --------------------------------------------------------------------------- |
| PENDING_VERIFICATION | ACTIVE     | SYSTEM (first verified channel, T-032)                                      |
| PENDING_VERIFICATION | CLOSED     | SYSTEM (30 days, no channel verified), SELF                                 |
| PENDING_VERIFICATION | SUSPENDED  | SYSTEM (risk block at signup)                                               |
| ACTIVE               | RESTRICTED | STAFF `user.restrict`, SYSTEM                                               |
| ACTIVE               | SUSPENDED  | STAFF `user.suspend`, SYSTEM                                                |
| ACTIVE               | LOCKED     | SYSTEM only (risk or fraud auto-lock)                                       |
| ACTIVE               | CLOSED     | SELF, STAFF `user.close`                                                    |
| RESTRICTED           | ACTIVE     | STAFF `user.reinstate`                                                      |
| RESTRICTED           | SUSPENDED  | STAFF `user.suspend`, SYSTEM (escalate)                                     |
| SUSPENDED            | ACTIVE     | STAFF `user.reinstate`                                                      |
| SUSPENDED            | CLOSED     | STAFF `user.close` (escalate)                                               |
| LOCKED               | ACTIVE     | SYSTEM (self-recovery or approved recovery request), STAFF `user.reinstate` |
| CLOSED               | ANONYMISED | SYSTEM only (`anonymiseUser`)                                               |

Every other pair is refused with 409 `INVALID_TRANSITION`. Any move to CLOSED is refused while a trade is non-terminal (CA1/CA2),
whoever asks. Statuses outside `USABLE_STATUSES` (SUSPENDED, LOCKED, CLOSED, ANONYMISED) run M1 D5's kill switch in the same transaction.

## Anonymisation (M1 §15)

One transaction: lock the user row; require CLOSED; refuse while a trade is active; retire the skeleton into `reserved_usernames`
(`SYSTEM`, `ON CONFLICT DO NOTHING`); tombstone handle `deleted_<12 hex>` with `skeleton()` of it; null the identifiers listed in §15 step 2;
delete emails, phones, social identities, credentials, devices, passkeys, MFA factors, OTP challenges and username history; revoke every
session; blank the sent invitations' destinations; scrub the profile; `anonymiseUserAddresses(tx, userId)`; publish `identity.user.status_changed`
and `identity.account.anonymised`; audit (the audit log itself is untouched, as §15 requires). Idempotent on an already-ANONYMISED user.

## Tests (written first)

Unit: transition matrix; recovery risk scoring. Integration (real Postgres, isolated DB prefix): each transition incl. kill switch and event;
close blocked by active trade and by wrong password; anonymisation leaves no identifier and keeps the row, reserves the old handle, scrubs addresses;
recovery intake -> event -> approve/reject, reviewer-not-subject; export/erasure idempotency and events; HTTP routes via the app harness.

## Owner decisions pending

Defaults applied; none touches money.

1. **How a SUSPENDED user reaches AS1/AS2 (resolved in the fixer phase).** A suspended, locked or closed account holds no session (D5), so `GET /me` cannot serve it. Instead `POST /auth/login` answers the holder of the RIGHT password with a 403 whose body carries `account` (status, `noticeKey`, `supportReference`, abilities; never the staff reason). A wrong password or unknown identifier is still the uniform 401 (§S3), so a stranger learns nothing. ANONYMISED never gets a notice. `openTrades` is `null` in this notice (login has no trade port); `GET /me` carries it for sessions that exist. Refresh keeps its 401. Open for the owner: whether AS2 needs `openTrades` on the login notice.
2. **Reason shown to the user.** `status_reason` is staff prose and may name a fraud signal. `/me` returns the status, the date, a support reference (the public id) and whether trades are open, never the reason text. Default: hide.
3. **What counts as an "active" trade for closing.** Any trade involving the user that is not in a terminal state, as the trade state machine defines terminal. Includes unfunded early states. Default: strictest.
4. **Self-service closing and erasure.** Allowed from ACTIVE, PENDING_VERIFICATION and RESTRICTED (a restricted holder can still sign in, so can always leave; NDPA). Refused for SUSPENDED and LOCKED, who have no session. Open for the owner: a staff-assisted route (support closes or erases on a documented request) for those two; staff can already close SUSPENDED through `/admin/users/:id/status`.
5. **Staff-initiated LOCKED.** Locking is a risk/system action (`lockAccount`, no staff route), because no `user.lock` permission exists in the M1 §12.2 catalogue. Default: system only.
6. **Recovery review permission.** M1 §12.2 has no recovery permission; review uses `user.reinstate`, the nearest "restore access" one (SUPER_ADMIN, OPERATIONS_ADMIN, COMPLIANCE_OFFICER). Default: reuse.
7. **Auto-approval threshold.** `RECOVERY_HUMAN_REVIEW_THRESHOLD` is 0: every request with any risk needs a human, and no code path completes a recovery without one. Requests at or under the threshold stay `CHALLENGED` for the existing OTP flow. Default: human on everything.
8. **What an approved recovery does.** Unlocks a LOCKED account, revokes all sessions and bumps the epoch. It does NOT reset credentials or MFA: those stay with the password reset flow and the two-person MFA reset (T-037). Default: minimal.
9. **Retention anonymisation is not scheduled.** `anonymiseUser` exists and refuses before 30 days after closure unless compliance has fulfilled a deletion request; no cron runs it, because a legal-hold check belongs to T-104. Only the 30-day close of abandoned registrations is scheduled. Default: manual/compliance-triggered.
10. **Erasure closes the account immediately.** `POST /me/erasure-request` closes (needs no active trade, password), then `scheduledFor` = now + 30 days is the SLA hint in the event. Default: close first.
11. **Duplicate export requests** within 24 hours return the first request's receipt instead of emitting a second event (deduplicated through the audit log; compliance's table arrives with T-104). Erasure needs no dedupe: it closes the account, and a closed account cannot sign in to ask again. A user who closed first and later wants erasure goes through support/compliance (T-104), not a route.
12. **Anonymising a staff member** is refused (a human decision, not a job's): revoke the role first. `destination_enc` is NOT NULL, so anonymised invitations hold an empty value rather than NULL.
13. **An unknown identifier on the recovery intake** is stored (volume is a signal) but opens no ticket; the response is identical (S3).
14. **`gateway.disconnectUser`** (T-027's note) is not called: identity cannot import the socket module. The socket re-validation sweep drops a suspended user's connection.
15. **Reason codes, not prose, leave the module.** `identity.user.status_changed` carries a code (`STAFF_SUSPEND`, `SELF_CLOSE`, ...); the staff note stays in `users.status_reason` and the audit log, and is cleared on anonymisation. A self-close stores only the ticked box (`NOT_USING | PRIVACY | SECURITY | OTHER`); `POST /me/close` no longer accepts free text.
16. **Recovery intake is an opaque receipt.** Every call returns a fresh random `receiptId` (never the request id), unknown identifiers store nothing, `evidenceRefs` is not accepted from anonymous callers (uploaded-evidence ownership has no check yet), and the call is held to a 400 ms floor to blunt the known-account timing difference. Open for the owner: an authenticated or OTP-verified evidence upload step.
17. **Close-vs-trade race.** Trade creation, counterparty send and invitation claim take `FOR SHARE` on the party's user row (`lockUserForTrade`) and refuse any non-ACTIVE party; a closure holds `FOR UPDATE` while it counts trades. The DB has no FK from `trades.*_user_id`, so this lock is the only guard.
18. **Files tombstone failure is only logged.** The committed `identity.account.anonymised` event is the retry hook; T-104 should re-drive it. Session `ip`/`user_agent` survive anonymisation until the 90-day session retention removes them (M1 §15).
