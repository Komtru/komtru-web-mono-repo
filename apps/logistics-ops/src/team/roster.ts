// The Team screen's decisions, as plain functions: how a roster is grouped, what each state is called,
// and what each refusal says. The screen draws these; the tests read them.
//
// Two kinds of "pending" are kept apart on purpose (m2 §8), because they mean different things to the
// admin who has to chase them:
//   - a MEMBER at INVITED has a Komtru account and simply has not signed in to the portal yet;
//   - an INVITATION is to an address no Komtru account has proved yet, and takes as long as the person
//     takes to sign up.
import type {
  LogisticsInvitation,
  LogisticsInviteOutcome,
  LogisticsMember,
  LogisticsRole,
} from '@komtru/api-client';
import { ProblemError } from '@komtru/api-client';

export const ROLE_LABEL: Record<LogisticsRole, string> = { ADMIN: 'Admin', OPERATOR: 'Operator' };

export const ROLE_OPTIONS = [
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'ADMIN', label: 'Admin' },
] as const;

export const ROLE_HELP: Record<LogisticsRole, string> = {
  OPERATOR: 'Handles pickups and tracking numbers',
  ADMIN: 'Also invites people and changes roles',
};

export interface Roster {
  /** Signed in at least once: working on the portal. */
  active: LogisticsMember[];
  /** Has an account, has not signed in here yet. Their first sign-in is their acceptance. */
  awaitingSignIn: LogisticsMember[];
  /** No account yet. Access arrives once they sign up with this email or phone. */
  awaitingSignUp: LogisticsInvitation[];
  /** Pending invitations whose week ran out: invite again. */
  expired: LogisticsInvitation[];
}

export function buildRoster(
  members: readonly LogisticsMember[],
  invitations: readonly LogisticsInvitation[],
): Roster {
  return {
    active: members.filter((member) => member.status === 'ACTIVE'),
    awaitingSignIn: members.filter((member) => member.status === 'INVITED'),
    awaitingSignUp: invitations.filter((invitation) => invitation.status === 'PENDING'),
    expired: invitations.filter((invitation) => invitation.status === 'EXPIRED'),
  };
}

/** How a person is named on the roster: their name, else their masked contact. */
export const displayName = (member: Pick<LogisticsMember, 'name' | 'contactMasked'>): string =>
  member.name ?? member.contactMasked ?? 'Komtru member';

/** One email or one phone, from the single field the invite form has. */
export function contactFrom(raw: string): { email: string } | { phone: string } | null {
  const value = raw.trim();
  if (value === '') return null;
  if (value.includes('@')) return { email: value };
  return /^\+?[\d\s()-]{7,}$/.test(value) ? { phone: value } : null;
}

export interface Notice {
  tone: 'success' | 'info' | 'risk' | 'warning';
  title: string;
  body: string;
}

/** T-161's two success states, never one generic "invited". */
export function inviteNotice(result: LogisticsInviteOutcome): Notice {
  if (result.outcome === 'LINKED') {
    return {
      tone: 'success',
      title: `Added — ${displayName(result.member)} can log in now`,
      body: 'They already have a Komtru account. We have let them know; their first sign-in here accepts the invitation.',
    };
  }
  return {
    tone: 'info',
    title: 'Pending — they get access once they sign up with this email or phone',
    body: `${result.invitation.contactMasked} has no Komtru account yet, so we cannot message them. Tell them yourself to sign up on Komtru with this ${result.invitation.channel === 'EMAIL' ? 'email' : 'phone number'}.`,
  };
}

/** What a refused team change says. `LAST_ADMIN` is explained, not reported. */
export function problemNotice(error: unknown): Notice {
  const code = error instanceof ProblemError ? error.code : undefined;
  switch (code) {
    case 'LAST_ADMIN':
      return {
        tone: 'warning',
        title: 'Promote someone else first',
        body: "You can't remove or demote the only admin. Make another active member an admin, then try again.",
      };
    case 'ALREADY_A_MEMBER':
      return { tone: 'warning', title: 'Already on your team', body: 'This person is already on your team.' };
    case 'CONFLICT':
      return {
        tone: 'warning',
        title: 'Already invited',
        body: 'This email or phone already has a pending invitation. Withdraw it first to send a new one.',
      };
    case 'VALIDATION_FAILED':
      return {
        tone: 'risk',
        title: 'Check the email or phone',
        body: 'Enter a valid email address or phone number.',
      };
    case 'FORBIDDEN':
      return { tone: 'risk', title: 'Admins only', body: 'Only a company admin can change the team.' };
    case 'NOT_FOUND':
    case 'INVALID_TRANSITION':
      return {
        tone: 'warning',
        title: 'That changed while you were looking',
        body: 'Someone else updated the team. The list has been refreshed.',
      };
    default:
      return { tone: 'risk', title: 'That did not go through', body: 'Try again in a moment.' };
  }
}

const DATE = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
export const formatDate = (iso: string): string => DATE.format(new Date(iso));
