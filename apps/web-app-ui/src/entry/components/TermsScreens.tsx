'use client';

import { useApiClient } from '@komtru/app-kit/react';
import { acceptTerms, getMyTerms, ProblemError } from '@komtru/api-client';
import { Button, NodeLoader } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ENTRY, UNAVAILABLE } from '../flow';
import { TERMS_CHANGES, TERMS_SECTIONS } from '../terms-copy';
import { AckCheckbox, EntryFrame, ErrorText } from './EntryFrame';

/**
 * Screen TOS2 — an existing account interrupted because the Terms in force are newer than the ones
 * it accepted. Reached from sign-in when the platform says `ACCEPT_TERMS` is owed.
 */
export function TermsUpdated({ next }: { next: string | undefined }): React.JSX.Element {
  const client = useApiClient();
  const router = useRouter();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const destination = next ?? '/';
  const terms = useQuery({
    queryKey: ['me', 'terms'],
    queryFn: () => client.call(getMyTerms, {}),
    // The answer decides whether this screen is shown at all; a cached one could be stale.
    staleTime: 0,
  });

  // Already accepted — another tab, or a stale link. Nothing to interrupt.
  useEffect(() => {
    if (terms.data?.upToDate === true) router.replace(destination);
  }, [terms.data?.upToDate, router, destination]);

  const agree = async (event: React.FormEvent) => {
    event.preventDefault();
    if (terms.data === undefined || !reviewed || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.call(acceptTerms, {
        body: { termsVersion: terms.data.termsVersion, privacyVersion: terms.data.privacyVersion },
      });
      router.replace(destination);
    } catch (error) {
      setBusy(false);
      if (error instanceof ProblemError && error.status === 409) {
        // Moved again while the screen was open: show the newer ones and ask again.
        setReviewed(false);
        setProblem('The Terms changed again while this was open. Review them once more, then agree.');
        void terms.refetch();
        return;
      }
      setProblem(UNAVAILABLE);
    }
  };

  if (terms.data === undefined || terms.data.upToDate) {
    const failed = terms.isError;
    return (
      <EntryFrame
        footer={
          failed ? (
            <Button type="button" onClick={() => void terms.refetch()}>
              Try again
            </Button>
          ) : undefined
        }
      >
        <h1 className="sr-only">Terms updated</h1>
        {!failed ? (
          <NodeLoader title="Checking the Terms" className="pt-[36px]" />
        ) : (
          <ErrorText>{UNAVAILABLE}</ErrorText>
        )}
      </EntryFrame>
    );
  }

  const changes = TERMS_CHANGES[terms.data.termsVersion] ?? [];

  return (
    <EntryFrame
      footer={
        <>
          <Button type="submit" form="terms-updated-form" disabled={!reviewed || busy}>
            {busy ? 'Saving…' : 'Agree & continue'}
          </Button>
          <Button asChild variant="ghost" className="self-center">
            <a href={ENTRY.fullTerms}>Read full terms</a>
          </Button>
        </>
      }
    >
      <form id="terms-updated-form" onSubmit={(event) => void agree(event)} className="pt-[20px]">
        <div className="mb-[20px] text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
            className="mx-auto mb-[14px] h-[44px] w-[44px] stroke-trust-indigo"
          >
            <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          <h1 className="mb-[6px] text-[17px] font-semibold">We&apos;ve updated our Terms</h1>
          <p className="mx-auto max-w-[260px] text-[12.5px] leading-[1.6] text-slate">
            Review the updated Terms of Service and Privacy Policy before you carry on.
          </p>
        </div>
        {changes.length > 0 && (
          <>
            <h2 className="mt-[18px] mb-[8px] text-[11px] font-bold tracking-[.04em] text-slate uppercase">
              What changed
            </h2>
            <dl>
              {changes.map((change) => (
                <div
                  key={change.label}
                  className="flex justify-between gap-[10px] border-b border-solid border-border-hairline py-[9px] text-[12.5px] last:border-b-0"
                >
                  <dt className="font-semibold">{change.label}</dt>
                  <dd className="max-w-[55%] text-right text-slate">{change.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <AckCheckbox checked={reviewed} onChange={setReviewed}>
          I&apos;ve reviewed the updated Terms of Service and Privacy Policy.
        </AckCheckbox>
        {problem !== null && <ErrorText>{problem}</ErrorText>}
      </form>
    </EntryFrame>
  );
}

/** The Terms in full, behind TOS1's link and TOS2's "Read full terms". Public: TOS1 runs signed out. */
export function FullTerms(): React.JSX.Element {
  return (
    <EntryFrame title="Terms & Privacy" back={ENTRY.welcome}>
      <h1 className="mb-[12px] text-[17px] font-semibold">Terms of Service and Privacy Policy</h1>
      {TERMS_SECTIONS.map((section) => (
        <section key={section.heading}>
          <h2 className="mt-[14px] mb-[6px] text-[12.5px] font-bold">{section.heading}</h2>
          <p className="mb-[8px] text-[12.5px] leading-[1.6] text-slate">{section.body}</p>
        </section>
      ))}
    </EntryFrame>
  );
}
