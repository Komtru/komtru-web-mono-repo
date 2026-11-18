'use client';

// F-081 on VF1: the contact half of "am I verified?".
//
// `verificationLevel` says whether BOTH channels are proven; it cannot say which one is missing, and
// a person looking at a refusal needs to know exactly that. So each channel gets a row, a badge and —
// when it is not done — the two steps that finish it.
//
// Only an UNPROVEN channel offers anything. A verified row is inert by design: the platform refuses to
// re-send for one (409 ALREADY_VERIFIED), because moving a proven address is the account-takeover path
// this feature deliberately does not open. Changing a proven number is SP-M05's job.
import type { ContactChannelState } from '@komtru/api-client';
import { useConfirmContactVerification, useStartContactVerification } from '@komtru/api-client/react';
import { Button, Chip, SectionLabel, TextField } from '@komtru/ui-kit';
import { useState } from 'react';

type Channel = 'EMAIL' | 'PHONE';

interface Contacts {
  email: ContactChannelState;
  phone: ContactChannelState;
}

const WORDING: Record<Channel, { label: string; field: string; placeholder: string }> = {
  EMAIL: { label: 'Email address', field: 'Email address', placeholder: 'you@example.com' },
  PHONE: { label: 'Phone number', field: 'Phone number', placeholder: '0803 000 0000' },
};

export function ContactChecks({ contacts }: { contacts: Contacts }): React.JSX.Element {
  return (
    <section aria-label="Your contact details" className="mb-[14px]">
      <SectionLabel>Your contact details</SectionLabel>
      <ContactRow channel="EMAIL" state={contacts.email} />
      <ContactRow channel="PHONE" state={contacts.phone} />
    </section>
  );
}

function ContactRow({ channel, state }: { channel: Channel; state: ContactChannelState }): React.JSX.Element {
  const words = WORDING[channel];
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const start = useStartContactVerification(channel);
  const confirm = useConfirmContactVerification(channel);

  const send = async () => {
    setProblem(null);
    setNotice(null);
    // An account with nothing on this channel has to say what to send to before anything can go out.
    if (!state.present && address.trim() === '') {
      setAsking(true);
      return;
    }
    try {
      const started = await start.mutateAsync(address.trim() === '' ? {} : { address: address.trim() });
      setChallengeId(started.challengeId);
      setSentTo(started.maskedDestination);
      setAsking(false);
      // `delivered: false` means the send budget was spent and NOTHING went out. Saying "we sent a
      // code" here would be a lie the person would wait on.
      setNotice(
        started.delivered
          ? `We sent a code to ${started.maskedDestination}.`
          : `We couldn’t send another code to ${started.maskedDestination} just yet. Try again in a few minutes.`,
      );
    } catch {
      setProblem(`We couldn’t send a code to that ${words.label.toLowerCase()}.`);
    }
  };

  const spend = async () => {
    if (challengeId === null) return;
    setProblem(null);
    try {
      await confirm.mutateAsync({ challengeId, code: code.trim() });
      setChallengeId(null);
      setCode('');
      setNotice(null);
    } catch {
      setProblem('That code didn’t match. Check it and try again.');
    }
  };

  const busy = start.isPending || confirm.isPending;

  return (
    <div
      role="group"
      aria-label={words.label}
      className="border-b border-solid border-border-hairline py-[9px] last:border-b-0"
    >
      <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
        <span className="font-semibold">{words.label}</span>
        <span className="flex items-center gap-[8px]">
          {state.masked !== null && <span className="text-slate">{state.masked}</span>}
          <Chip tone={state.verified ? 'verified' : 'awaiting'}>
            {state.verified ? 'Verified' : 'Not verified'}
          </Chip>
        </span>
      </div>

      {!state.verified && (
        <div className="mt-[10px] flex flex-col gap-[8px]">
          {(asking || !state.present) && challengeId === null && (
            <TextField
              label={words.field}
              placeholder={words.placeholder}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          )}

          {challengeId !== null && (
            <TextField
              label="Enter the code"
              inputMode="numeric"
              autoComplete="one-time-code"
              helper={sentTo === null ? undefined : `Sent to ${sentTo}`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}

          {notice !== null && <p className="text-[12px] text-slate">{notice}</p>}
          {problem !== null && (
            <p role="alert" className="text-[12px] text-risk-on-soft">
              {problem}
            </p>
          )}

          <span>
            {challengeId === null ? (
              <Button type="button" disabled={busy} onClick={() => void send()}>
                {state.present ? 'Verify' : `Add ${words.label.toLowerCase()}`}
              </Button>
            ) : (
              <Button type="button" disabled={busy || code.trim() === ''} onClick={() => void spend()}>
                Confirm
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
