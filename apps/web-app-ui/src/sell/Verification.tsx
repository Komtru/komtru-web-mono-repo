'use client';

import type { MerchantApplication, PayoutAccount } from '@komtru/api-client';
import { useMyMerchantApplication, usePayoutAccounts, useVerificationStatus } from '@komtru/api-client/react';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  type ChipTone,
  FOCUS_RING,
  cx,
} from '@komtru/ui-kit';
import { ContactSupport } from '../account/ContactSupport';
import { LoadProblem, Loading } from '../account/states';
import {
  ACCOUNT_VERIFICATION_HREF,
  LIVE_HREF,
  STEP_HREF,
  changeLabel,
  changesByStep,
  nextStep,
  phaseOf,
  valuesFrom,
} from './rules';

const INFO_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const ALERT_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

/**
 * M2 (T-121): "Business Verification", the Verification section of the account, for merchant status. One screen for
 * every state the application can be in, except a rejection, which has its own (BVR1). It is the way into the
 * verification flow. Each check says what the platform knows now; none of them is decided here.
 */
export function SellVerification(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const verification = useVerificationStatus();
  const accounts = usePayoutAccounts();

  if (application.isPending || verification.isPending || accounts.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader
          title="Merchant verification"
          backHref={ACCOUNT_VERIFICATION_HREF}
          backLabel="Back to verification"
        />
        <Loading label="Loading your verification" lines={4} />
      </ScreenColumn>
    );
  }
  if (application.data === undefined || verification.data === undefined || accounts.data === undefined) {
    return (
      <ScreenColumn>
        <ScreenHeader
          title="Merchant verification"
          backHref={ACCOUNT_VERIFICATION_HREF}
          backLabel="Back to verification"
        />
        <LoadProblem
          what="your verification"
          onRetry={() => {
            void application.refetch();
            void verification.refetch();
            void accounts.refetch();
          }}
        />
      </ScreenColumn>
    );
  }

  const app = application.data;
  const phase = phaseOf(app);
  const identity = verification.data.requirements.identifier && verification.data.requirements.liveness;
  const payout = accounts.data.find((account) => account.status === 'VERIFIED');

  if (phase === 'NOT_STARTED') {
    return (
      <ScreenColumn>
        <ScreenHeader
          title="Merchant verification"
          backHref={ACCOUNT_VERIFICATION_HREF}
          backLabel="Back to verification"
        />
        <EmptyState
          title="Your business isn’t verified yet"
          body="Until you are a merchant, the amount you can transact as a default seller is limited. Verifying your business lifts that limit."
          action={
            <Button asChild>
              <a href={STEP_HREF.start}>Start merchant verification</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }
  if (phase === 'REJECTED' && app !== null) {
    return <Rejected application={app} />;
  }

  return (
    <ScreenColumn>
      <ScreenHeader
        title="Merchant verification"
        backHref={ACCOUNT_VERIFICATION_HREF}
        backLabel="Back to verification"
      />
      {phase === 'CHANGES_REQUESTED' && <ChangesRequested application={app} />}
      <TermList>
        <Row
          label="Owner identity"
          checked={identity}
          chip={identity ? ['verified', 'Verified'] : ['awaiting', 'Not yet']}
        />
        <Row
          label="Business registration"
          checked={phase === 'APPROVED'}
          chip={registrationChip(phase)}
          detail={app?.form.cacRcNumber ?? undefined}
        />
        <Row
          label="Payout account"
          checked={payout !== undefined}
          chip={payout !== undefined ? ['verified', 'Verified'] : ['awaiting', 'Not yet']}
          detail={payout !== undefined ? payoutDetail(payout) : undefined}
        />
        <Row
          label="Storefront address"
          checked={phase === 'APPROVED'}
          chip={storefrontChip(phase, app)}
          detail={app?.form.addressLine ?? undefined}
        />
      </TermList>
      {phase === 'DRAFTING' && app !== null && (
        <Button asChild>
          <a href={STEP_HREF[nextStep(valuesFrom(app), app)]}>Continue your application</a>
        </Button>
      )}
      {phase === 'IN_REVIEW' && app !== null && (
        <Banner tone="info" icon={INFO_MARK} title="With our team">
          The application can’t be changed while it is being reviewed. If they need something, they will ask
          here.
          <div className="mt-[8px]">
            <ContactSupport label="Contact support" reference={app.id} />
          </div>
        </Banner>
      )}
      {phase === 'APPROVED' && (
        <Button asChild>
          <a href={LIVE_HREF}>See your merchant status</a>
        </Button>
      )}
      <Banner tone="info" icon={INFO_MARK} className="mt-[16px]">
        Merchant verification gives you the “Verified Merchant” badge on your Trust Passport, and lifts the
        limit on what you can transact as a default seller.
      </Banner>
    </ScreenColumn>
  );
}

/** The status of the registration and the storefront, both of which the application decides. */
function registrationChip(phase: ReturnType<typeof phaseOf>): [ChipTone, string] {
  switch (phase) {
    case 'APPROVED':
      return ['verified', 'Verified'];
    case 'IN_REVIEW':
      return ['verifying', 'Verifying'];
    case 'CHANGES_REQUESTED':
      return ['awaiting', 'Changes requested'];
    default:
      return ['awaiting', 'Not submitted'];
  }
}

/** The storefront address is the one the seller named on SO1, so it is only "changed" when staff named one of its fields. */
function storefrontChip(
  phase: ReturnType<typeof phaseOf>,
  app: MerchantApplication | null,
): [ChipTone, string] {
  if (phase === 'CHANGES_REQUESTED') {
    const named = (app?.changesRequested ?? []).some((item) =>
      ['addressLine', 'stateId', 'cityId'].includes(item.key),
    );
    return named ? ['awaiting', 'Changes requested'] : ['awaiting', 'Not yet'];
  }
  return phase === 'DRAFTING' || phase === 'NOT_STARTED'
    ? ['awaiting', 'Not submitted']
    : registrationChip(phase);
}

function payoutDetail(account: PayoutAccount): string {
  const last4 = account.accountNumberMasked.slice(-4);
  return `${account.bankName ?? 'Bank'} •••• ${last4}`;
}

function Row({
  label,
  checked,
  chip,
  detail,
}: {
  label: string;
  checked: boolean;
  chip: [ChipTone, string];
  detail?: string;
}): React.JSX.Element {
  return (
    <TermRow label={label} checked={checked}>
      <span className="flex flex-col items-end gap-[4px]">
        <Chip tone={chip[0]}>{chip[1]}</Chip>
        {detail !== undefined && <span className="text-right text-[11px] text-slate">{detail}</span>}
      </span>
    </TermRow>
  );
}

function ChangesRequested({ application }: { application: MerchantApplication | null }): React.JSX.Element {
  const groups = changesByStep(application?.changesRequested ?? []);
  return (
    <Banner tone="warning" icon={ALERT_MARK} title="Staff need a few changes">
      <ul className="m-0 mt-[8px] list-none p-0">
        {groups.flatMap((group) =>
          group.items.map((item) => (
            <li key={`${item.kind}-${item.key}`} className="mb-[8px] flex flex-col gap-[2px]">
              <a
                href={STEP_HREF[group.step]}
                className={cx(FOCUS_RING, 'font-semibold text-midnight-text underline')}
              >
                Fix {changeLabel(item)}
              </a>
              {item.note !== undefined && <span className="text-[11.5px] text-slate">{item.note}</span>}
            </li>
          )),
        )}
      </ul>
    </Banner>
  );
}

/** BVR1: the seller-facing outcome of a rejection. The reason is the reviewer's own words, shown as written. */
function Rejected({ application }: { application: MerchantApplication }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader
        title="Merchant verification"
        backHref={ACCOUNT_VERIFICATION_HREF}
        backLabel="Back to verification"
      />
      <TermList>
        <TermRow label="Business registration" checked={false}>
          <span className="flex flex-col items-end gap-[4px]">
            <Chip tone="risk">Rejected</Chip>
            <span className="text-right text-[11px] text-slate">Not approved</span>
          </span>
        </TermRow>
      </TermList>
      <Banner tone="risk" icon={ALERT_MARK} title="Why">
        {application.lastDecision?.reason ?? 'The reviewer did not give a reason.'}
      </Banner>
      <SectionLabel>What you can still do</SectionLabel>
      <TermList>
        <TermRow label="Selling as a default seller" checked>
          Limited until you are a merchant
        </TermRow>
        <TermRow label="“Verified Merchant” badge" checked={false}>
          Not available yet
        </TermRow>
        <TermRow label="Resubmit" checked={false}>
          Anytime, with corrected details
        </TermRow>
      </TermList>
      <div className="mt-[16px] flex flex-col gap-[8px]">
        <Button asChild>
          <a href={STEP_HREF['verify-business']}>Resubmit CAC details</a>
        </Button>
        <ContactSupport label="Contact support" reference={application.id} />
      </div>
    </ScreenColumn>
  );
}
