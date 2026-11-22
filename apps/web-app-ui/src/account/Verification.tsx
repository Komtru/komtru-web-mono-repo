'use client';

import { type VerificationRejection, type VerificationStatus } from '@komtru/api-client';
import {
  useMe,
  useSubmitBvn,
  useAbandonLivenessSession,
  useStartLivenessSession,
  useSubmitNin,
  useVerificationStatus,
} from '@komtru/api-client/react';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  RiskBanner,
  ScreenHeader,
  OptionCard,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  TermList,
  TermRow,
  TextField,
} from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { isProductionHost } from '../hosts';
import { VERIFICATION_HREF } from '../sell/rules';
import { ContactSupport } from './ContactSupport';
import { activeRejections } from './rejections';
import { ContactChecks } from './VerifyContact';
import { Loading, LoadProblem } from './states';
import { accountProblem } from './words';

const ALERT_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

/** The three checks this screen can send again. Any other type would be sent as the wrong check, so it gets no form. */
const RESUBMITTABLE: ReadonlySet<string> = new Set(['NIN', 'BVN', 'LIVENESS']);

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

export { activeRejections };

/**
 * VF1 (and the verification list it lives in). What failed and why come from the platform, copy included, so a screen
 * that gates somebody's income never words a refusal itself. A failed ID check can be sent again here: an ID number with
 * the name on it, or a clearer selfie. Checks that are not about the person's ID (business, address, social) show their
 * reason and no resubmit: those screens belong to other tickets.
 */
export function Verification(): React.JSX.Element {
  const status = useVerificationStatus();
  const me = useMe();
  const ready = me.data !== undefined && status.data !== undefined;

  // F-084 links here at a section (`#contact`, `#identity`). Both sections render only once their data is read, so
  // the browser's own jump on load finds nothing: jump once they exist.
  useEffect(() => {
    if (!ready) return;
    const target = window.location.hash.slice(1);
    if (target === 'contact' || target === 'identity') document.getElementById(target)?.scrollIntoView();
  }, [ready]);

  return (
    /*
      Mobile is the baseline and the reference draws VF1 for mobile web only, so the column is
      unchanged at base. Wider screens follow the house treatment HomeScreen and Payouts already
      use rather than a shape invented here: roomier at `md`, and at `lg` the checklist moves
      beside the action instead of under it. Recorded as a deviation in docs/ui-review, because
      the reference has no desktop drawing to check against.
    */
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
      <ScreenHeader title="Verification" backHref="/account" backLabel="Back to your account" />
      {/*
        Contact first, and outside the `status` branch above: email and phone are level 1 and they
        gate trading, so somebody sent here by "confirm both your email address and your phone
        number" must see which one is missing even while the KYC checks are still loading.
      */}
      {me.data !== undefined && <ContactChecks contacts={me.data.contacts} />}
      {status.isPending ? (
        <Loading label="Loading your verification" />
      ) : status.data === undefined ? (
        <LoadProblem what="your verification" onRetry={() => void status.refetch()} />
      ) : (
        <Loaded status={status.data} reference={me.data?.account.supportReference} />
      )}
      <SettingsGroup label="Merchant">
        <SettingsRow
          label="Merchant verification"
          sub="Your business registration and payout account"
          href={VERIFICATION_HREF}
        />
      </SettingsGroup>
    </div>
  );
}

function Loaded({
  status,
  reference,
}: {
  status: VerificationStatus;
  reference: string | undefined;
}): React.JSX.Element {
  /*
    One grid for all three states.

    "What's needed" used to be repeated at the end of every branch. Hoisting it here is what makes
    the desktop column possible at all — the checklist has to be a sibling of the action to sit
    beside it — and it removes three copies of the same line.
  */
  return (
    // `#identity`: where F-084's "Verify your ID" step on Home and Shop lands.
    <div
      id="identity"
      className="scroll-mt-[72px] gap-[16px] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start"
    >
      <div className="min-w-0">
        <LoadedMain status={status} reference={reference} />
      </div>
      <Requirements status={status} />
    </div>
  );
}

function LoadedMain({
  status,
  reference,
}: {
  status: VerificationStatus;
  reference: string | undefined;
}): React.JSX.Element {
  const failures = activeRejections(status);
  const waiting = status.inFlight;
  // An API too old to send one reads the same as an account with nothing in it: no name to lock
  // to, so the fields stay typeable rather than locking somebody out of a form nothing can fill.
  const nameClaim = status.nameClaim ?? EMPTY_CLAIM;

  if (failures.length === 0 && waiting.length === 0) {
    const done = status.requirements.identifier && status.requirements.liveness;
    if (done) {
      return (
        <>
          <EmptyState
            title="You’re verified"
            body="Your ID and selfie check are done."
            className="mb-[14px]"
          />
        </>
      );
    }

    /*
      The screen's start path, and the reason this branch is no longer an empty state.

      It used to read "Nothing to fix" over a checklist of things that were not done — true in the
      narrow sense that nothing had failed, and useless, because the person arrived here to begin.
      §4's order decides which control appears: an identifier first, then the selfie it is matched
      against. Offering both at once would let a user into a camera flow the backend refuses.
    */
    return <>{status.requirements.identifier ? <StartSelfie /> : <StartIdentity nameClaim={nameClaim} />}</>;
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
          nameClaim={nameClaim}
        />
      ))}
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
  nameClaim,
}: {
  rejection: VerificationRejection;
  reference: string;
  nameClaim: NameClaim;
}): React.JSX.Element {
  const { reason } = rejection;
  const outcome = OUTCOME[reason.outcome];
  const canResubmit =
    RESUBMITTABLE.has(rejection.type) &&
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
          {/*
            A failed selfie is retried through the provider SDK, not a photo upload.

            `ResubmitSelfie` used to live here, posting a file to `/verification/liveness`. Since
            F-045 the verdict only ever arrives on a signed Youverify webhook, so an upload could
            produce no decision at all — the user would send a photo and wait forever.
          */}
          {rejection.type === 'LIVENESS' ? (
            <SelfieLauncher />
          ) : (
            <ResubmitId type={rejection.type} nameClaim={nameClaim} />
          )}
        </>
      )}
      <div className="mt-[8px]">
        <ContactSupport label="Contact support instead" reference={reference} />
      </div>
    </section>
  );
}

/**
 * Whether the person may choose the name their ID is checked against.
 *
 * Two conditions, and the API applies the same pair before it builds the claim: off the
 * production host anybody may type (Youverify's sandbox IDs answer to fixed names that match no
 * tester's account), and on it they may type only when the account has no complete name to stand
 * in — a one-word name at sign-up leaves no surname, and locking an empty box would leave
 * somebody with a form they can neither complete nor correct.
 *
 * `typeof window` guard: this file renders on the server too, where there is no host to read and
 * nothing is interactive yet.
 */
function nameIsEditable(claim: NameClaim): boolean {
  const onProduction = typeof window !== 'undefined' && isProductionHost(window.location.host);
  if (!onProduction) return true;
  return claim.firstName === null || claim.lastName === null;
}

type NameClaim = { firstName: string | null; lastName: string | null };

const EMPTY_CLAIM: NameClaim = { firstName: null, lastName: null };

/** NIN or BVN, in the person's words rather than the platform's. */
const ID_CHOICES = [
  {
    type: 'NIN',
    title: 'National Identity Number',
    description: 'The 11 digits on your NIN slip or national ID card.',
  },
  {
    type: 'BVN',
    title: 'Bank Verification Number',
    description: 'The 11 digits your bank issued you. Dial *565*0# to see yours.',
  },
] as const;

function ResubmitId({ type, nameClaim }: { type: string; nameClaim: NameClaim }): React.JSX.Element {
  const nin = useSubmitNin();
  const bvn = useSubmitBvn();
  /*
    Which ID, as a choice rather than a fact about the last failure.

    It opens on `type` — the check that failed, or NIN for somebody starting — and the person can
    change it. Pinning it would make the second ID unreachable: a NIN that fails on a name
    mismatch is exactly the case where the BVN is worth trying, and this screen is the only place
    either one can be sent from.
  */
  const [idType, setIdType] = useState(type === 'BVN' ? 'BVN' : 'NIN');
  const [number, setNumber] = useState('');
  const [firstName, setFirstName] = useState(nameClaim.firstName ?? '');
  const [lastName, setLastName] = useState(nameClaim.lastName ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const isBvn = idType === 'BVN';
  const editable = nameIsEditable(nameClaim);
  const digits = number.replace(/\D/g, '');
  const pending = nin.isPending || bvn.isPending;
  const ready = digits.length === 11 && firstName.trim() !== '' && lastName.trim() !== '' && !pending;

  /** Switching clears the number: eleven digits of a NIN re-sent as a BVN is a spent call and a failure nobody can explain. */
  const chooseId = (next: string) => {
    setIdType(next);
    setNumber('');
    setProblem(undefined);
  };

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
      <fieldset className="mb-[4px] border-0 p-0">
        <legend className="mb-[8px] block text-[12px] font-semibold">Which ID do you have?</legend>
        {ID_CHOICES.map((choice) => (
          <OptionCard
            key={choice.type}
            name="id-type"
            value={choice.type}
            checked={idType === choice.type}
            description={choice.description}
            onChange={(event) => chooseId(event.target.value)}
          >
            {choice.title}
          </OptionCard>
        ))}
      </fieldset>
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
        disabled={!editable}
        onChange={(event) => setFirstName(event.target.value)}
      />
      <TextField
        label="Last name"
        autoComplete="family-name"
        value={lastName}
        disabled={!editable}
        helper={
          editable
            ? 'Exactly as it is on your ID.'
            : 'We check the name on your account against the ID. To change it, contact support.'
        }
        onChange={(event) => setLastName(event.target.value)}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button type="submit" disabled={!ready}>
        {pending ? 'Sending…' : 'Resubmit'}
      </Button>
    </form>
  );
}

/**
 * The first step: a NIN or a BVN.
 *
 * It reuses `ResubmitId`, which until now only ever appeared under a rejection — the form is the
 * same form, and the only thing that differed was that nobody could reach it.
 */
function StartIdentity({ nameClaim }: { nameClaim: NameClaim }): React.JSX.Element {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <section aria-label="Verify your identity" className="mb-[14px]">
        <Banner tone="info" title="Verify your identity">
          We’ll check your NIN or BVN against the national record, then ask for a selfie. It usually takes
          under a minute.
        </Banner>
        <Button type="button" onClick={() => setStarted(true)}>
          Verify your ID
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Verify your identity" className="mb-[14px]">
      <SectionLabel>Your ID</SectionLabel>
      <ResubmitId type="NIN" nameClaim={nameClaim} />
    </section>
  );
}

/**
 * The second step, and the one that leaves this codebase.
 *
 * Youverify's SDK is a browser global loaded from a CDN, so it is imported on the press rather than
 * bundled: nobody who never verifies should download it. Its callbacks move the UI and NOTHING
 * else — `onSuccess` takes no payload and anyone can call it from a console, so the verdict comes
 * from the signed webhook and reaches this screen over the socket that already updates it.
 */
function SelfieLauncher({ intro = false }: { intro?: boolean }): React.JSX.Element {
  const start = useStartLivenessSession();
  const abandon = useAbandonLivenessSession();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);

  /**
   * The person shut the modal without finishing, so the request must end now.
   *
   * Left open it sits at PROVIDER_PENDING until the §6.2 sweep expires it a day later, and for
   * that whole day this screen shows "We're checking" over a check nobody is performing — with no
   * control to press, because the start branch only renders when nothing is in flight.
   *
   * Still inert as to the VERDICT. It says "this attempt is over", never "this person failed";
   * the platform decides that on the signed webhook and nowhere else.
   *
   * A failure here is swallowed on purpose. The worst case is the request expiring on its own
   * later, which is exactly where we were before — so there is nothing useful to tell the user,
   * and an error banner over a camera they just closed would only confuse.
   */
  const endSession = async (requestId: string) => {
    setRunning(false);
    try {
      await abandon.mutateAsync(requestId);
    } catch {
      // Deliberately ignored; see above.
    }
  };

  const open = async () => {
    setProblem(undefined);
    setRunning(true);
    try {
      const session = await start.mutateAsync();
      const sdk = await loadYouverifySdk();
      const liveness = new sdk.liveness({
        publicMerchantKey: session.publicMerchantKey,
        sandboxEnvironment: session.sandbox,
        metadata: { reference: session.reference },
        // Still inert as to the verdict: `onSuccess` carries no payload and anyone can call it
        // from a console, so it only keeps the button busy while the webhook is in flight.
        onSuccess: () => setRunning(true),
        onFailure: () => void endSession(session.requestId),
        onClose: () => void endSession(session.requestId),
      });
      liveness.initialize();
      liveness.start();
    } catch (error) {
      setRunning(false);
      setProblem(accountProblem(error, 'verify-id'));
    }
  };

  return (
    <>
      {intro && (
        <Banner tone="info" title="One more step">
          Your ID is verified. Now a quick selfie so we know it’s you — it opens your camera and takes about
          ten seconds.
        </Banner>
      )}
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button type="button" disabled={running || start.isPending} onClick={() => void open()}>
        {running || start.isPending ? 'Opening…' : 'Take a selfie check'}
      </Button>
    </>
  );
}

/**
 * The first step's framing around the launcher.
 *
 * Only the start branch owns a region of its own. Inside a rejection the launcher is rendered bare,
 * because `Failure` has already opened a section named "Selfie check" — nesting a second region
 * with the same name gives a screen reader two things by that name and gives a test an ambiguous
 * query.
 */
function StartSelfie(): React.JSX.Element {
  return (
    <section aria-label="Selfie check" className="mb-[14px]">
      <SelfieLauncher intro />
    </section>
  );
}

interface YouverifyLiveness {
  initialize: () => void;
  start: () => void;
}
interface YouverifySdk {
  liveness: new (options: Record<string, unknown>) => YouverifyLiveness;
}

/**
 * Loads the SDK from the CDN once, on first press.
 *
 * `youverify-web-sdk` publishes a browser global rather than a module this build can import, and
 * it is dead weight for every user who never reaches this screen — so it is a script tag appended
 * on demand, and a second press reuses whatever the first one loaded.
 */
const SDK_SRC = 'https://cdn.jsdelivr.net/npm/youverify-web-sdk@2.2.1/dist/index.min.js';
let sdkLoading: Promise<YouverifySdk> | undefined;

function loadYouverifySdk(): Promise<YouverifySdk> {
  const existing = (globalThis as { YouverifySDK?: YouverifySdk }).YouverifySDK;
  if (existing) return Promise.resolve(existing);
  sdkLoading ??= new Promise<YouverifySdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      const sdk = (globalThis as { YouverifySDK?: YouverifySdk }).YouverifySDK;
      if (sdk) resolve(sdk);
      else reject(new Error('the verification SDK loaded but did not register'));
    };
    script.onerror = () => {
      // Let a later press try again rather than caching the failure for the session.
      sdkLoading = undefined;
      reject(new Error('the verification SDK could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return sdkLoading;
}
