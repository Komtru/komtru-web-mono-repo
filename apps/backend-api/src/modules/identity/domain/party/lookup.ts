// The pure half of party lookup (M1 §8.1, §8.3, §8.4): turning what the client typed into the one
// canonical form the database is indexed on, and deciding whether a row we found may be shown.
//
// Both halves are here, away from the service, because they are the rules a reviewer should be able
// to read in one sitting — and because `partyVisible` is the decision that MUST happen after all the
// work rather than instead of it (§8.3 control 4). A pure predicate is hard to accidentally turn
// into an early return in a query.
import { normaliseEmail, normalisePhone } from '../../../../platform/identifiers.js';

export type LookupChannel = 'USERNAME' | 'EMAIL' | 'PHONE';

export interface LookupKey {
  channel: LookupChannel;
  /**
   * The form the index covers: `email_normal` for an email, E.164 for a phone, the folded handle
   * for a username. Never what the user typed — uniqueness that depends on the caller having
   * remembered to lowercase is not uniqueness (platform/identifiers.ts).
   */
  canonical: string;
}

/** Handles are stored lower-case and the `@` is a sigil, not part of the name (§6.1). */
const foldHandle = (raw: string): string => raw.trim().replace(/^@+/, '').toLowerCase();

export const lookupKeyForUsername = (raw: string): LookupKey | null => {
  const canonical = foldHandle(raw);
  return canonical.length > 0 ? { channel: 'USERNAME', canonical } : null;
};

export const lookupKeyForEmail = (raw: string): LookupKey | null => {
  try {
    return { channel: 'EMAIL', canonical: normaliseEmail(raw).emailNormal };
  } catch {
    return null;
  }
};

export const lookupKeyForPhone = (raw: string): LookupKey | null => {
  const normalised = normalisePhone(raw);
  return normalised ? { channel: 'PHONE', canonical: normalised.phoneE164 } : null;
};

/**
 * §8.1: a username miss cannot produce an invitation. `party_invitations.channel` is an
 * `otp_channel` — SMS, EMAIL, WHATSAPP, VOICE — and a handle that does not exist gives us nothing to
 * send to, so the client must fall back to asking for a contact channel.
 */
export const canInviteOn = (channel: LookupChannel): boolean => channel !== 'USERNAME';

export interface Discoverability {
  status: string;
  discoverableByUsername: boolean;
  discoverableByEmail: boolean;
  discoverableByPhone: boolean;
}

/**
 * §8.3 controls 5 and 8, as one predicate evaluated AFTER the row is already in hand.
 *
 * A suspended or closed account is invisible, so lookup cannot be used to probe an enforcement
 * action; a flag that is off is invisible on that channel ONLY, because hiding your email address
 * from search is not a request to disappear from the handle you hand out on purpose.
 */
export const partyVisible = (row: Discoverability, channel: LookupChannel): boolean => {
  if (row.status !== 'ACTIVE') return false;
  if (channel === 'USERNAME') return row.discoverableByUsername;
  if (channel === 'EMAIL') return row.discoverableByEmail;
  return row.discoverableByPhone;
};

/** §8.4: three characters before any result, and never more than eight of them. */
export const MIN_TYPEAHEAD_CHARS = 3;
export const MAX_TYPEAHEAD_RESULTS = 8;

export const typeaheadPrefix = (raw: string): string | null => {
  const prefix = foldHandle(raw);
  return prefix.length >= MIN_TYPEAHEAD_CHARS ? prefix : null;
};

/**
 * Makes a prefix a literal inside `LIKE … ESCAPE '\'`.
 *
 * Without it a single `%` matches every handle on the platform, which is precisely the namespace
 * walk §8.4 forbids by allowing prefix matching and nothing else. The backslash is replaced FIRST,
 * or the escapes added for `%` and `_` would themselves be escaped.
 */
export const escapeLikePrefix = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
