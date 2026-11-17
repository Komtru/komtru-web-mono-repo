'use client';

import {
  UploadError,
  uploadFile,
  type VerificationRejection,
  type VerificationStatus,
} from '@komtru/api-client';
import {
  useApiClient,
  useMe,
  useSubmitBvn,
  useSubmitLiveness,
  useSubmitNin,
  useVerificationStatus,
} from '@komtru/api-client/react';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  FileDropzone,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  TextField,
  type MediaItem,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { ContactSupport } from './ContactSupport';
import { Loading, LoadProblem } from './states';
import { accountProblem } from './words';

const ALERT_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

const KYC_FILE = { category: 'KYC_DOCUMENT', visibility: 'PRIVATE_OWNER' } as const;

/** What each check is called to the person. NIN and BVN are two ways to say the one thing VF1 is about: an ID. */
const CHECK_NAME: Record<string, string> = {
  NIN: 'Government-issued ID',
  BVN: 'Government-issued ID',
  LIVENESS: 'Selfie check',
  CAC: 'Business registration',
  BANK_ACCOUNT_NAME_MATCH: 'Business bank account',
  ADDRESS: 'Proof of address',
  DOCUMENT: 'Document',
  SOCIAL_PROOF: 'Social profile',
};

const OUTCOME: Record<
  VerificationRejection['reason']['outcome'],
  { line: string; chip: string; tone: 'risk' | 'verifying' }
> = {
  FAILED: { line: 'Couldn’t be verified', chip: 'Failed', tone: 'risk' },
  REJECTED: { line: 'Not approved', chip: 'Rejected', tone: 'risk' },
  UNDER_REVIEW: { line: 'A person is looking at it', chip: 'In review', tone: 'verifying' },
};

/**
 * A rejection is the platform's latest word on a check only until a newer attempt of the same kind is on its way; after a
 * resubmission the old failure stops being the answer, and showing it above "we're checking" would say two things.
 */
export function activeRejections(status: VerificationStatus): VerificationRejection[] {
  return status.rejections.filter(
    (rejection) =>
      !status.inFlight.some(
        (request) =>
          request.type === rejection.type &&
          (rejection.decidedAt === null || request.submittedAt > rejection.decidedAt),
      ),
  );
}

/**
 * VF1 (and the verification list it lives in). What failed and why come from the platform, copy included, so a screen
 * that gates somebody's income never words a refusal itself. A failed ID check can be sent again here: an ID number with
 * the name on it, or a clearer selfie. Checks that are not about the person's ID (business, address, social) show their
 * reason and no resubmit: those screens belong to other tickets.
 */
export function Verification(): React.JSX.Element {
  const status = useVerificationStatus();
  const me = useMe();

  return (
    <ScreenColumn>
      <ScreenHeader title="Verification" backHref="/account" backLabel="Back to your account" />
      {status.isPending ? (
        <Loading label="Loading your verification" />
      ) : status.data === undefined ? (
        <LoadProblem what="your verification" onRetry={() => void status.refetch()} />
      ) : (
        <Loaded status={status.data} reference={me.data?.account.supportReference} />
      )}
    </ScreenColumn>
  );
}

function Loaded({
  status,
  reference,
}: {
  status: VerificationStatus;
  reference: string | undefined;
}): React.JSX.Element {
  const failures = activeRejections(status);
  const waiting = status.inFlight;

  if (failures.length === 0 && waiting.length === 0) {
    return (
      <>
        <EmptyState
          title={
            status.requirements.identifier && status.requirements.liveness
              ? 'You’re verified'
              : 'Nothing to fix'
          }
          body={
            status.requirements.identifier && status.requirements.liveness
              ? 'Your ID and selfie check are done.'
              : 'Nothing has failed. Verify your ID to start selling.'
          }
          className="mb-[14px]"
        />
        <Requirements status={status} />
      </>
    );
  }

  return (
    <>
      {waiting.length > 0 && (
        <Banner tone="info" title="We’re checking">
          {waiting.map((request) => CHECK_NAME[request.type] ?? 'A document').join(', ')} — we’ll tell you the
          moment there’s a decision.
        </Banner>
      )}
      {failures.map((rejection) => (
        <Failure
          key={rejection.requestId}
          rejection={rejection}
          reference={reference ?? rejection.requestId}
        />
      ))}
      <Requirements status={status} />
    </>
  );
}

function Requirements({ status }: { status: VerificationStatus }): React.JSX.Element {
  return (
    <section aria-label="What’s needed">
      <SectionLabel>What’s needed</SectionLabel>
      <TermList>
        <TermRow label="Government-issued ID" checked={status.requirements.identifier}>
          {status.requirements.identifier ? 'Done' : 'Not yet'}
        </TermRow>
        <TermRow label="Selfie check" checked={status.requirements.liveness}>
          {status.requirements.liveness ? 'Done' : 'Not yet'}
        </TermRow>
      </TermList>
    </section>
  );
}

function Failure({
  rejection,
  reference,
}: {
  rejection: VerificationRejection;
  reference: string;
}): React.JSX.Element {
  const { reason } = rejection;
  const outcome = OUTCOME[reason.outcome];
  const canResubmit =
    reason.surface === 'VF1' &&
    reason.outcome !== 'UNDER_REVIEW' &&
    (reason.remedy === 'RESUBMIT' || reason.remedy === 'RESUBMIT_WITH_CLEARER_PHOTO');

  return (
    <section aria-label={CHECK_NAME[rejection.type] ?? 'Verification'} className="mb-[8px]">
      <div className="mb-[14px] flex items-center gap-[12px]">
        <span
          aria-hidden
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[50%] bg-risk-soft stroke-risk-on-soft"
        >
          <span className="h-[18px] w-[18px]">{ALERT_MARK}</span>
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[13px]">{CHECK_NAME[rejection.type] ?? 'Verification'}</b>
          <span className="block text-[11.5px] text-slate">{outcome.line}</span>
        </span>
        <Chip tone={outcome.tone}>{outcome.chip}</Chip>
      </div>
      <Banner tone="warning" icon={ALERT_MARK} title={reason.whyHeading}>
        {reason.why}
      </Banner>
      {canResubmit && (
        <>
          <SectionLabel>Try again</SectionLabel>
          {rejection.type === 'LIVENESS' ? <ResubmitSelfie /> : <ResubmitId type={rejection.type} />}
        </>
      )}
      <div className="mt-[8px]">
        <ContactSupport label="Contact support instead" reference={reference} />
      </div>
    </section>
  );
}

function ResubmitSelfie(): React.JSX.Element {
  const client = useApiClient();
  const submit = useSubmitLiveness();
  const [file, setFile] = useState<File | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const media: MediaItem[] = file === undefined ? [] : [{ id: 'selfie', kind: 'photo', alt: file.name }];

  const send = async () => {
    if (file === undefined) return;
    setProblem(undefined);
    setUploading(true);
    try {
      const selfieFileId = await uploadFile(client, file, KYC_FILE);
      await submit.mutateAsync(selfieFileId);
      setFile(undefined);
    } catch (error) {
      setProblem(
        error instanceof UploadError
          ? error.reason === 'TOO_LARGE'
            ? 'That photo is too large. Choose a smaller one.'
            : 'That photo didn’t upload. Check your connection and try again.'
          : accountProblem(error, 'verify-id'),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <FileDropzone
        label="Upload a clearer photo"
        hint="Flat surface, good light, all four corners visible"
        media={media}
        requiredCount={0}
        slots={2}
        accept="image/jpeg,image/png,image/webp"
        onAdd={(files) => setFile(files[0])}
        onRemove={() => setFile(undefined)}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button
        type="button"
        disabled={file === undefined || uploading || submit.isPending}
        onClick={() => void send()}
      >
        {uploading || submit.isPending ? 'Sending…' : 'Resubmit'}
      </Button>
    </>
  );
}

function ResubmitId({ type }: { type: string }): React.JSX.Element {
  const nin = useSubmitNin();
  const bvn = useSubmitBvn();
  const [number, setNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const isBvn = type === 'BVN';
  const digits = number.replace(/\D/g, '');
  const pending = nin.isPending || bvn.isPending;
  const ready = digits.length === 11 && firstName.trim() !== '' && lastName.trim() !== '' && !pending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setProblem(undefined);
    const claim = { firstName: firstName.trim(), lastName: lastName.trim() };
    const options = { onError: (error: unknown) => setProblem(accountProblem(error, 'verify-id')) };
    if (isBvn) bvn.mutate({ bvn: digits, ...claim }, options);
    else nin.mutate({ nin: digits, ...claim }, options);
  };

  return (
    <form onSubmit={submit} noValidate>
      <TextField
        label={isBvn ? 'BVN' : 'NIN'}
        inputMode="numeric"
        autoComplete="off"
        maxLength={14}
        mono
        value={number}
        helper="The 11 digits, as they are on your ID."
        onChange={(event) => setNumber(event.target.value.replace(/[^\d\s-]/g, ''))}
      />
      <TextField
        label="First name"
        autoComplete="given-name"
        value={firstName}
        onChange={(event) => setFirstName(event.target.value)}
      />
      <TextField
        label="Last name"
        autoComplete="family-name"
        value={lastName}
        helper="Exactly as it is on your ID."
        onChange={(event) => setLastName(event.target.value)}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button type="submit" disabled={!ready}>
        {pending ? 'Sending…' : 'Resubmit'}
      </Button>
    </form>
  );
}
