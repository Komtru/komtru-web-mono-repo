// What a controller may read off the request, with the two guards every caller needs.
//
// Shared rather than copied because three columns in this module are `inet`
// (`sessions.ip`, `otp_challenges.created_ip`, `users.registration_ip`, `users.consent_ip`) and a
// value that reaches any of them unchecked is a 22P02 from Postgres and a 500 from us.
import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * `X-Forwarded-For` is honoured only as far as `TRUST_PROXY_HOPS` lets express honour it — and
 * whatever comes back is checked before it reaches an `inet` column. A mis-set hop count makes
 * `req.ip` attacker-controlled, and `'; DROP'` in that header would otherwise be a 22P02 from
 * Postgres and a 500 from us. An unparseable address is simply not recorded.
 */
export const callerIp = (req: Request): string | null =>
  req.ip !== undefined && isIP(req.ip) ? req.ip : null;

export const callerAgent = (req: Request): string | null => req.get('user-agent') ?? null;
