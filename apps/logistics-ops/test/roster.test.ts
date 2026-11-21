// T-161's decisions: the two pending kinds kept apart, the two invite success states, and LAST_ADMIN
// explained as "Promote someone else first".
import { ProblemError, type LogisticsInvitation, type LogisticsMember } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import { buildRoster, contactFrom, inviteNotice, problemNotice } from '../src/team/roster';

const member = (overrides: Partial<LogisticsMember> = {}): LogisticsMember => ({
  id: crypto.randomUUID(),
  name: 'Ada Obi',
  contactMasked: 'a•••@swift.ng',
  role: 'OPERATOR',
  status: 'ACTIVE',
  invitedAt: '2026-11-20T09:00:00.000Z',
  acceptedAt: null,
  removedAt: null,
  ...overrides,
});

const invitation = (overrides: Partial<LogisticsInvitation> = {}): LogisticsInvitation => ({
  id: crypto.randomUUID(),
  role: 'OPERATOR',
  channel: 'PHONE',
  contactMasked: '+23480•••4567',
  status: 'PENDING',
  invitedAt: '2026-11-20T09:00:00.000Z',
  expiresAt: '2026-11-27T09:00:00.000Z',
  ...overrides,
});

const problem = (code: string, status = 409) =>
  new ProblemError(
    { type: 'about:blank', status, code, title: code },
    {
      requestId: undefined,
      retryAfterMs: undefined,
      rateLimit: undefined,
      replayed: false,
    } as never,
    false,
  );

describe('buildRoster', () => {
  it('keeps waiting-to-sign-in members apart from waiting-to-sign-up invitations, and drops the rest', () => {
    const roster = buildRoster(
      [member(), member({ status: 'INVITED' }), member({ status: 'REMOVED' })],
      [
        invitation(),
        invitation({ status: 'EXPIRED' }),
        invitation({ status: 'ACCEPTED' }),
        invitation({ status: 'CANCELLED' }),
      ],
    );
    expect(roster.active).toHaveLength(1);
    expect(roster.awaitingSignIn).toHaveLength(1);
    expect(roster.awaitingSignUp).toHaveLength(1);
    expect(roster.expired).toHaveLength(1);
  });
});

describe('inviteNotice', () => {
  it('says LINKED people can log in now', () => {
    const notice = inviteNotice({ outcome: 'LINKED', member: member({ status: 'INVITED', name: null }) });
    expect(notice.title).toBe('Added — they can log in now');
    expect(notice.body).toContain('a•••@swift.ng');
  });

  it('says PENDING people get access once they sign up, and that the admin must tell them', () => {
    const notice = inviteNotice({ outcome: 'PENDING', invitation: invitation() });
    expect(notice.title).toBe('Pending — they get access once they sign up with this email or phone');
    expect(notice.body).toContain('Tell them yourself');
  });
});

describe('problemNotice', () => {
  it('explains LAST_ADMIN as "Promote someone else first"', () => {
    expect(problemNotice(problem('LAST_ADMIN')).title).toBe('Promote someone else first');
  });

  it('names a duplicate member and a duplicate invitation, and falls back for anything else', () => {
    expect(problemNotice(problem('ALREADY_A_MEMBER')).title).toBe('Already on your team');
    expect(problemNotice(problem('CONFLICT')).title).toBe('Already invited');
    expect(problemNotice(new Error('boom')).title).toBe('That did not go through');
  });
});

describe('contactFrom', () => {
  it('reads an email or a phone from one field', () => {
    expect(contactFrom(' ada@swift.ng ')).toEqual({ email: 'ada@swift.ng' });
    expect(contactFrom('0803 123 4567')).toEqual({ phone: '0803 123 4567' });
    expect(contactFrom('+234 803 123 4567')).toEqual({ phone: '+234 803 123 4567' });
    expect(contactFrom('ada')).toBeNull();
    expect(contactFrom('')).toBeNull();
  });
});
