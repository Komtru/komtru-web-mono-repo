'use client';

import { useApiClient } from '@komtru/app-kit/react';
import { getPublishedTerms, ProblemError, register } from '@komtru/api-client';
import { Button } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useDraft } from './useDraft';
import { signUpCode, signUpDraft } from '../drafts';
import { ENTRY, failureMessage, UNAVAILABLE } from '../flow';
import { TERMS_SECTIONS } from '../terms-copy';
import { AckCheckbox, EntryFrame, ErrorText, InlineLink } from './EntryFrame';

const FORM = 'terms-form';

type Failure =
  | { kind: 'taken' }
  | { kind: 'stale' }
  | { kind: 'invalid-contact'; message: string }
  | { kind: 'message'; message: string };

/** Screen TOS1 — consent during sign-up, before the account is created. */
export function TermsForm(): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const draft = useDraft(signUpDraft);
  const [terms, setTerms] = useState(false);
  const [profile, setProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  /**
   * The versions in force, read when the screen opens. What is sent is exactly what was read, so the
   * consent recorded is consent to the copy on screen; if the platform has moved on by the time the
   * person agrees, it refuses, and the screen reads again and asks again.
   */
  const published = useQuery({
    queryKey: ['auth', 'terms'],
    queryFn: () => client.call(getPublishedTerms, {}),
    staleTime: 0,
  });

  // A reload in a tab with nothing remembered, or a link straight here: start at the number.
  useEffect(() => {
    if (draft === null) router.replace(ENTRY.signUp);
  }, [draft, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!terms || !profile || draft === null || draft === undefined || busy) return;
    const versions = published.data;
    if (versions === undefined) return;
    // The account already exists and a code is out for this number — coming back here from E3 must
    // not open a second account and send a second SMS. E2 forgets the code when the number changes.
    if (signUpCode.read() !== null) {
      router.push(ENTRY.verify);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const created = await client.call(register, {
        body: {
          channel: 'PHONE',
          phone: draft.phone,
          email: draft.email,
          fullName: draft.fullName,
          acceptedTermsVersion: versions.termsVersion,
          acceptedPrivacyVersion: versions.privacyVersion,
        },
      });
      signUpCode.write({
        challengeId: created.challengeId,
        destination: created.maskedDestination,
        delivered: created.delivered,
        sentAt: Date.now(),
      });
      router.push(ENTRY.verify);
    } catch (error) {
      const next = failureFor(error);
      if (next.kind === 'stale') {
        setTerms(false);
        void published.refetch();
      }
      setFailure(next);
      setBusy(false);
    }
  };

  return (
    <EntryFrame
      title="Terms & Privacy"
      back={ENTRY.signUp}
      footer={
        published.isError ? (
          <Button type="button" onClick={() => void published.refetch()}>
            Try again
          </Button>
        ) : (
          <Button
            type="submit"
            form={FORM}
            disabled={!terms || !profile || busy || published.data === undefined}
          >
            {busy ? 'Creating account…' : 'Agree & create account'}
          </Button>
        )
      }
    >
      <form id={FORM} onSubmit={(event) => void submit(event)}>
        <h1 className="sr-only">Review the Terms of Service and Privacy Policy</h1>
        <section
          aria-label="Terms of Service and Privacy Policy summary"
          tabIndex={0}
          className="mb-[16px] h-[280px] overflow-y-auto rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]"
        >
          {TERMS_SECTIONS.map((section) => (
            <div key={section.heading}>
              <h2 className="mt-[14px] mb-[6px] text-[12.5px] font-bold first:mt-0">{section.heading}</h2>
              <p className="mb-[8px] text-[11.5px] leading-[1.6] text-slate">{section.body}</p>
            </div>
          ))}
          <p className="text-[11.5px] leading-[1.6] text-slate">
            <InlineLink href={ENTRY.fullTerms}>Read the full Terms of Service and Privacy Policy</InlineLink>
          </p>
        </section>
        <AckCheckbox checked={terms} onChange={setTerms}>
          I&apos;ve read and accept the Terms of Service and Privacy Policy.
        </AckCheckbox>
        <AckCheckbox checked={profile} onChange={setProfile}>
          I understand my Trust Profile is visible to people I trade with.
        </AckCheckbox>
        {published.isError && <ErrorText>{UNAVAILABLE}</ErrorText>}
        {failure !== null && <FailureText failure={failure} />}
      </form>
    </EntryFrame>
  );
}

function FailureText({ failure }: { failure: Failure }): React.JSX.Element {
  switch (failure.kind) {
    case 'taken':
      return (
        <ErrorText>
          That number already has a Komtru account. <InlineLink href={ENTRY.login}>Log in</InlineLink>{' '}
          instead, or <InlineLink href={ENTRY.forgot}>reset your password</InlineLink>.
        </ErrorText>
      );
    case 'stale':
      return (
        <ErrorText>The Terms were updated a moment ago. Read them again, then agree to carry on.</ErrorText>
      );
    case 'invalid-contact':
      return (
        <ErrorText>
          {failure.message}. <InlineLink href={ENTRY.signUp}>Change your details</InlineLink>
        </ErrorText>
      );
    case 'message':
      return <ErrorText>{failure.message}</ErrorText>;
  }
}

/**
 * The platform answers a taken number and stale Terms with the same 409 (`CONFLICT`); only the
 * title tells them apart (`registration.controller.ts`). Anything that is not the stale-Terms title
 * is read as taken, which is the common case and the one with something to do about it.
 */
function failureFor(error: unknown): Failure {
  if (!(error instanceof ProblemError)) return { kind: 'message', message: UNAVAILABLE };
  if (error.status === 409) {
    return error.problem.title === 'The Terms have changed' ? { kind: 'stale' } : { kind: 'taken' };
  }
  if (error.status === 422) {
    const contact = error.problem.errors?.find((entry) => entry.path === 'phone' || entry.path === 'email');
    if (contact !== undefined)
      return { kind: 'invalid-contact', message: contact.message.replace(/\.$/, '') };
    return { kind: 'message', message: error.problem.detail ?? error.problem.title };
  }
  if (error.status === 429) {
    return {
      kind: 'message',
      message: failureMessage({
        kind: 'limited',
        wait: error.retryAfterMs === undefined ? undefined : Math.ceil(error.retryAfterMs / 1000),
      }),
    };
  }
  return { kind: 'message', message: UNAVAILABLE };
}
