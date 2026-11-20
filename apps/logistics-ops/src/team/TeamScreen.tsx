'use client';

import type { LogisticsInvitation, LogisticsMe, LogisticsMember, LogisticsRole } from '@komtru/api-client';
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionLabel,
  Select,
  TextField,
  type ChipTone,
} from '@komtru/ui-kit';
import { useId, useState } from 'react';
import { useTeam, useTeamMutations } from './hooks';
import {
  ROLE_LABEL,
  ROLE_OPTIONS,
  buildRoster,
  contactFrom,
  displayName,
  formatDate,
  inviteNotice,
  problemNotice,
  type Notice,
} from './roster';

export interface TeamScreenProps {
  me: LogisticsMe;
  isAdmin: boolean;
}

const NoticeBanner = ({ notice }: { notice: Notice }): React.JSX.Element => (
  <Banner tone={notice.tone} title={notice.title}>
    {notice.body}
  </Banner>
);

/**
 * T-161. The roster in three groups — working, waiting to sign in, waiting to sign up — with the
 * invite form and the per-person controls drawn only for an admin. An operator sees who is on the
 * team and nothing they cannot use; the backend refuses them either way.
 */
export function TeamScreen({ me, isAdmin }: TeamScreenProps): React.JSX.Element {
  const { members, invitations } = useTeam();
  const [notice, setNotice] = useState<Notice | null>(null);

  if (members.isPending || invitations.isPending) {
    return (
      <p role="status" className="text-[12px] text-slate">
        Loading your team…
      </p>
    );
  }
  if (members.isError || invitations.isError) {
    return (
      <EmptyState
        tone="error"
        title="We could not load your team"
        body="Check your connection and try again."
        action={
          <Button
            type="button"
            onClick={() => {
              void members.refetch();
              void invitations.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const roster = buildRoster(members.data.items, invitations.data.items);

  return (
    <div className="max-w-[760px]">
      {notice !== null && <NoticeBanner notice={notice} />}
      {isAdmin ? (
        <InviteForm onNotice={setNotice} />
      ) : (
        <Banner tone="info" title="Only an admin can change the team">
          Ask an admin at {me.company.name} to invite someone or change a role.
        </Banner>
      )}

      <SectionLabel>On the team · {roster.active.length}</SectionLabel>
      {roster.active.length === 0 ? (
        <p className="m-0 mb-[16px] text-[12.5px] text-slate">Nobody has signed in yet.</p>
      ) : (
        roster.active.map((member) => (
          <MemberRow key={member.id} member={member} me={me} isAdmin={isAdmin} onNotice={setNotice} />
        ))
      )}

      <SectionLabel>Waiting to sign in · {roster.awaitingSignIn.length}</SectionLabel>
      <p className="m-0 mb-[10px] text-[12px] leading-[1.5] text-slate">
        They have a Komtru account. Their first sign-in to this portal accepts the invitation.
      </p>
      {roster.awaitingSignIn.map((member) => (
        <MemberRow key={member.id} member={member} me={me} isAdmin={isAdmin} onNotice={setNotice} />
      ))}

      <SectionLabel>Waiting to sign up · {roster.awaitingSignUp.length + roster.expired.length}</SectionLabel>
      <p className="m-0 mb-[10px] text-[12px] leading-[1.5] text-slate">
        No Komtru account yet, so we cannot message them. Tell them to sign up on Komtru with this email or
        phone; access arrives once they do.
      </p>
      {[...roster.awaitingSignUp, ...roster.expired].map((invitation) => (
        <InvitationRow key={invitation.id} invitation={invitation} isAdmin={isAdmin} onNotice={setNotice} />
      ))}
    </div>
  );
}

function InviteForm({ onNotice }: { onNotice: (notice: Notice | null) => void }): React.JSX.Element {
  const { invite } = useTeamMutations();
  const headingId = useId();
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<LogisticsRole>('OPERATOR');
  const [invalid, setInvalid] = useState(false);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const parsed = contactFrom(contact);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onNotice(null);
    invite.mutate(
      { ...parsed, role },
      {
        onSuccess: (result) => {
          onNotice(inviteNotice(result));
          setContact('');
        },
        onError: (error) => onNotice(problemNotice(error)),
      },
    );
  };

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <h2 id={headingId} className="m-0 mb-[4px] font-display text-[15px] font-semibold">
          Invite someone
        </h2>
        <p className="m-0 mb-[12px] text-[12px] leading-[1.5] text-slate">
          Use the email or phone they use for Komtru. If they don’t have an account yet, they get access once
          they sign up with it.
        </p>
        <form onSubmit={submit} noValidate className="grid gap-x-[12px] sm:grid-cols-[1fr_220px]">
          <TextField
            label="Email or phone"
            name="contact"
            autoComplete="off"
            value={contact}
            invalid={invalid}
            {...(invalid ? { helper: 'Enter an email address or a phone number' } : {})}
            onChange={(event) => setContact(event.target.value)}
          />
          <Select
            label="Role"
            name="role"
            value={role}
            options={ROLE_OPTIONS}
            onChange={(event) => setRole(event.target.value as LogisticsRole)}
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={invite.isPending || contact.trim() === ''}>
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

const MEMBER_CHIP: Record<'ACTIVE' | 'INVITED', { tone: ChipTone; label: string }> = {
  ACTIVE: { tone: 'verified', label: 'Active' },
  INVITED: { tone: 'awaiting', label: 'Not signed in yet' },
};

function MemberRow({
  member,
  me,
  isAdmin,
  onNotice,
}: {
  member: LogisticsMember;
  me: LogisticsMe;
  isAdmin: boolean;
  onNotice: (notice: Notice | null) => void;
}): React.JSX.Element | null {
  const { changeRole, remove } = useTeamMutations();
  const [confirming, setConfirming] = useState(false);
  if (member.status === 'REMOVED') return null;
  const chip = MEMBER_CHIP[member.status];
  const self = member.id === me.member.id;
  const busy = changeRole.isPending || remove.isPending;
  const name = displayName(member);

  const otherRole: LogisticsRole = member.role === 'ADMIN' ? 'OPERATOR' : 'ADMIN';

  return (
    <Card layout="row" className="items-center">
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13.5px] font-semibold text-midnight-text">
          {name}
          {self && <span className="font-normal text-slate"> (you)</span>}
        </p>
        <p className="m-0 mt-[2px] text-[11.5px] text-slate">
          {ROLE_LABEL[member.role]}
          {member.contactMasked !== null && member.name !== null ? ` · ${member.contactMasked}` : ''}
          {member.status === 'INVITED' ? ` · added ${formatDate(member.invitedAt)}` : ''}
        </p>
      </div>
      <Chip tone={chip.tone}>{chip.label}</Chip>
      {isAdmin && (
        <div className="flex shrink-0 items-center gap-[12px]">
          {confirming ? (
            <>
              <Button
                type="button"
                variant="danger"
                className="w-auto"
                disabled={busy}
                onClick={() =>
                  remove.mutate(member.id, {
                    onSuccess: () =>
                      onNotice({
                        tone: 'success',
                        title: `${name} was removed`,
                        body: 'They keep their Komtru account; they can no longer use this portal.',
                      }),
                    onError: (error) => onNotice(problemNotice(error)),
                    onSettled: () => setConfirming(false),
                  })
                }
              >
                Remove {self ? 'me' : name}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  changeRole.mutate(
                    { id: member.id, role: otherRole },
                    {
                      onSuccess: () =>
                        onNotice({
                          tone: 'success',
                          title: `${name} is now ${otherRole === 'ADMIN' ? 'an admin' : 'an operator'}`,
                          body:
                            otherRole === 'ADMIN'
                              ? 'They can now invite people and change roles.'
                              : 'They can no longer manage the team.',
                        }),
                      onError: (error) => onNotice(problemNotice(error)),
                    },
                  )
                }
              >
                {otherRole === 'ADMIN' ? 'Make admin' : 'Make operator'}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function InvitationRow({
  invitation,
  isAdmin,
  onNotice,
}: {
  invitation: LogisticsInvitation;
  isAdmin: boolean;
  onNotice: (notice: Notice | null) => void;
}): React.JSX.Element {
  const { withdraw } = useTeamMutations();
  const expired = invitation.status === 'EXPIRED';
  return (
    <Card layout="row" className="items-center">
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate font-mono text-[13px] text-midnight-text">{invitation.contactMasked}</p>
        <p className="m-0 mt-[2px] text-[11.5px] text-slate">
          {ROLE_LABEL[invitation.role]} · invited {formatDate(invitation.invitedAt)}
          {expired ? '' : ` · expires ${formatDate(invitation.expiresAt)}`}
        </p>
      </div>
      <Chip tone={expired ? 'risk' : 'verifying'}>
        {expired ? 'Expired — invite again' : 'Not signed up yet'}
      </Chip>
      {isAdmin && !expired && (
        <Button
          type="button"
          variant="ghost"
          disabled={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(invitation.id, {
              onSuccess: () =>
                onNotice({
                  tone: 'success',
                  title: 'Invitation withdrawn',
                  body: `${invitation.contactMasked} will not get access if they sign up.`,
                }),
              onError: (error) => onNotice(problemNotice(error)),
            })
          }
        >
          Withdraw
        </Button>
      )}
    </Card>
  );
}
