# T-038 Staff invitations: implementation plan

Ticket: `docs/tickets/03-identity.md` T-038. Depends on T-037 (merged). Spec: M1 section 5.10 and 8.5 (party
invitations are the template), section 10.6 and 12.3 (staff admin), S9 (envelope encryption).

## Shape

An invitation is created by a SUPER_ADMIN (`role.grant`, reason required) for an email address and a staff role.
It stores `destination_hash` (HMAC, own domain), `destination_masked` and `destination_enc` (sealed), a
`token_hash` (SHA-256 of a 256-bit token), the role, an optional absolute grant expiry, and a 7-day invitation
expiry. No `users` row is ever created by an invitation.

Acceptance is by an authenticated CONSUMER session of the user who owns the address, because the OTP facility
delivers to a user's own contact (`identity.otp.requested` carries a `userId`, not an address):

1. `POST /me/staff-invitations/start { token }`: the session user's primary email must be verified and equal the
   invited address (hash compare). Only the verified PRIMARY email is matched, never a secondary or unverified one; issues an OTP (`SENSITIVE_ACTION`, EMAIL) to it.
2. `POST /me/staff-invitations/accept { token, challengeId, code }`: consumes the OTP (it must belong to this
   user, this purpose and this address), then grants through `insertAssignment` so every T-037 rule applies
   (second factor, 365-day box, two-holder SUPER_ADMIN cap, one live grant per role). A dual-approval role
   opens a `ROLE_GRANT` approval (requested by the inviter, who must still hold SUPER_ADMIN) instead.
   The OTP spend commits even when the grant is refused (savepoint), so attempts cannot be refunded.

New users: they register through the normal flow with the invited address. When that address is verified,
`bindStaffInvitationsForDestination` (called next to `claimInvitationsForDestination`) records `bound_user_id`
on matching pending invitations. It grants nothing: a fresh account has no second factor, so the role is
granted by step 2 after MFA enrolment.

Admin surface: `POST/GET /admin/staff-invitations`, `DELETE /admin/staff-invitations/:id` (all `role.grant`).
A sweep `expireStaffInvitations` marks lapsed PENDING rows EXPIRED.

## Steps (test first, commit after each green step)

1. Domain `domain/staff-invitation.ts` (+ unit tests): token, hash domain, TTL, grant validation, status guards.
2. Drizzle schema `staff_invitations` (TypeScript only), events, audit actions.
3. Service + route/validation declarations, with route tests. Mount in `index.ts`, hook into verification.
4. AFTER MIGRATION (blocked on config's migration landing): merge main, `drizzle-kit generate`, integration tests
   (create, never-plaintext, accept existing user, MFA refusal, dual approval, cap, bind on verify, expiry sweep).

## Open decisions (most restrictive option taken)

- Only SUPER_ADMIN may invite (`role.grant`), for any role including dual-approval ones.
- One pending invitation per address and role; self-invitation refused; inviter must still be SUPER_ADMIN at accept.
- 7-day invitation expiry (party invitations use 14).
- Email only; no phone, so no SMS channel.
- The token is returned once to the inviting admin; nothing delivers it yet (no notify template).
- Grant expiry is absolute; absent means 365 days from acceptance.

## Review follow-ups (2026-11-06)

- The acceptance OTP is issued against an invitation-bound destination hash (invitation id plus address), so a
  `SENSITIVE_ACTION` code from any other flow cannot satisfy it. No new OTP purpose or enum migration needed.
- One pending invitation per address and role is a partial unique index (23505 maps to 409); a lapsed but unswept
  row is expired by the next invite for the same pair. `expires_at` has a partial index for the sweep.
- At accept the inviter must still be SUPER_ADMIN and `users.status = 'ACTIVE'`; a dual-approval role is refused
  before claiming when the invitee already holds it or a ROLE_GRANT for it is pending.
- A refused grant writes a `STAFF_INVITATION_ACCEPTED` audit row with outcome `DENIED`.
