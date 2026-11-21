// Who the caller is, worked out again from scratch on every request.
//
// Design §7.3 is explicit that role and membership are never cached on the token, and this is the
// file that honours it: the access token is only ever used to find the session row, and everything
// that decides what the caller may do — the session's own state, the user's status and epoch, the
// live role grants — is read from Postgres each time. The cost is one indexed query; the benefit is
// that revoking a role or a session takes effect on the caller's next request rather than their next
// login.
import { sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import {
  actorFor,
  rejectedActor,
  type Actor,
  type CompanyMembership,
} from '../../../platform/http/principal.js';
import { sessionUsableUnder } from '../domain/session/status.js';
import type { AccessTokenClaims, TokenSigner } from '../infrastructure/jwt/access-token.js';
import type { EpochCache } from '../infrastructure/redis/epoch-cache.js';

export interface PrincipalDeps {
  db: Db;
  signer: TokenSigner;
  epochs: EpochCache;
  logger: Logger;
  /**
   * A LOGISTICS caller's company and role (m2 §2). T-086 supplies the real query against
   * `logistics_company_members`; until then nobody has a membership, and the LOGISTICS scope works
   * for everything that does not require one.
   */
  companyMembership?: (db: Db, userId: string) => Promise<CompanyMembership | null>;
}

interface SessionRow extends Record<string, unknown> {
  session_id: string;
  user_id: string;
  family_id: string;
  scope: string;
  amr: string[] | null;
  revoked_at: Date | null;
  expired: boolean;
  public_id: string;
  status: string;
  sessions_epoch: number;
  roles: string[] | null;
  permissions: string[] | null;
}

/**
 * One statement, so a request costs one round trip. The role join is the live-grant rule in SQL:
 * not revoked, not past `expires_at` (which is how an expired grant stops authorising with no job
 * having run), and carrying a second approver when the role demands one.
 */
const principalQuery = (sessionId: string, userId: string) => sql`
  SELECT s.id              AS session_id,
         s.user_id,
         s.family_id,
         s.scope::text     AS scope,
         s.amr,
         s.revoked_at,
         (s.idle_expires_at <= now() OR s.absolute_expires_at <= now()) AS expired,
         u.public_id,
         u.status::text    AS status,
         u.sessions_epoch,
         live.roles,
         live.permissions
    FROM identity.sessions s
    JOIN identity.users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT a.role_code) FILTER (WHERE a.role_code IS NOT NULL) AS roles,
             array_agg(DISTINCT rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL)
               AS permissions
        FROM identity.admin_role_assignments a
        JOIN identity.roles r ON r.code = a.role_code
        LEFT JOIN identity.role_permissions rp ON rp.role_code = a.role_code
       WHERE a.user_id = s.user_id
         AND a.revoked_at IS NULL
         AND (a.expires_at IS NULL OR a.expires_at > now())
         AND (NOT r.requires_dual_approval OR a.approved_by IS NOT NULL)
    ) live ON true
   WHERE s.id = ${sessionId}::uuid
     AND s.user_id = ${userId}::uuid`;

export async function resolvePrincipal(deps: PrincipalDeps, token: string): Promise<Actor> {
  const verified = await deps.signer.verify(token);
  if (verified === null) return rejectedActor('TOKEN_INVALID');
  if ('expired' in verified) return rejectedActor('TOKEN_EXPIRED');
  const claims: AccessTokenClaims = verified;

  // The fast deny path, and `<` rather than `!==` on purpose. `sessions_epoch` only ever increases,
  // so a token BEHIND the cache is certainly dead and can be refused here. A token ahead of it only
  // means the cache is behind — a request that read the row just before a bump can write the old
  // value back afterwards — and refusing that would 401 a perfectly good token for a whole TTL.
  // A cached epoch that does not refuse proves nothing, so the query runs anyway.
  const cached = await deps.epochs.read(claims.sub);
  if (cached !== undefined && claims.epc < cached) return rejectedActor('EPOCH_STALE');

  const { rows } = await deps.db.execute<SessionRow>(principalQuery(claims.sid, claims.sub));
  const row = rows[0];
  // A session id that does not resolve is indistinguishable from one that was deleted: both mean
  // this credential no longer names a live session.
  if (!row) return rejectedActor('SESSION_REVOKED');
  if (row.revoked_at !== null) return rejectedActor('SESSION_REVOKED');
  if (row.expired) return rejectedActor('SESSION_EXPIRED');
  // `consumed_at` is deliberately not checked: it is the refresh token's state, not the session's.
  // The access token minted beside it is bounded by its own ten-minute `exp`, and every revocation
  // path revokes the whole `family_id`, so a rotated session still dies the moment the family does.
  if (row.scope !== claims.scp) return rejectedActor('TOKEN_INVALID');
  if (row.sessions_epoch !== claims.epc) {
    // Authoritative, and the reason a stale cache is a performance bug rather than a security one.
    await deps.epochs.write(row.user_id, row.sessions_epoch);
    return rejectedActor('EPOCH_STALE');
  }
  if (!sessionUsableUnder(row.status)) return rejectedActor('USER_INACTIVE');

  // Only on a miss. Rewriting a value the cache already holds costs a Redis round trip per request
  // and buys nothing: the entry is already correct, and its TTL bounds how long it may lag.
  if (cached === undefined) await deps.epochs.write(row.user_id, row.sessions_epoch);

  return actorFor({
    userId: row.user_id,
    publicId: row.public_id,
    sessionId: row.session_id,
    familyId: row.family_id,
    scope: claims.scp,
    status: row.status,
    sessionsEpoch: row.sessions_epoch,
    amr: row.amr ?? [],
    roles: row.roles ?? [],
    permissions: new Set(row.permissions ?? []),
    // Only a LOGISTICS session acts for a company: a consumer or staff session of the same person is
    // not a company member, and asking for its membership would be a query per request for nothing.
    companyMembership:
      claims.scp === 'LOGISTICS' ? ((await deps.companyMembership?.(deps.db, row.user_id)) ?? null) : null,
  });
}
