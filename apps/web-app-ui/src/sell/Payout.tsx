'use client';

import { ProblemError, type PayoutAccount } from '@komtru/api-client';
import {
  useAddPayoutAccount,
  useBanks,
  useMyMerchantApplication,
  usePayoutAccounts,
  useResubmitMerchantApplication,
  useSaveMerchantDraft,
  useSubmitMerchantApplication,
} from '@komtru/api-client/react';
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  OptionCard,
  RiskBanner,
  Select,
  TextField,
  SectionLabel,
} from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoadProblem, Loading } from '../account/states';
import { SellFrame } from './Frame';
import { STEP_HREF, VERIFICATION_HREF, phaseOf } from './rules';
import type { MerchantApplication } from '@komtru/api-client';

const INFO_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

/**
 * SO4 (T-121): "Where Should We Send Payouts?". The payout account is one the bank has verified: the name on it is the
 * bank's, never typed here. Confirming saves the choice and sends the application, or sends it again when staff asked
 * for changes. Once a verified account exists the form gives way to the choice.
 */
export function SellPayout(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const accounts = usePayoutAccounts();

  if (application.isPending || accounts.isPending) {
    return (
      <SellFrame title="Payout Account" step={4} backHref={STEP_HREF['verify-business']} action={null}>
        <Loading label="Loading your payout accounts" lines={3} />
      </SellFrame>
    );
  }
  if (application.data === undefined || accounts.data === undefined) {
    return (
      <SellFrame title="Payout Account" step={4} backHref={STEP_HREF['verify-business']} action={null}>
        <LoadProblem
          what="your application"
          onRetry={() => {
            void application.refetch();
            void accounts.refetch();
          }}
        />
      </SellFrame>
    );
  }
  if (application.data === null) {
    return (
      <SellFrame title="Payout Account" step={4} backHref={STEP_HREF['verify-business']} action={null}>
        <EmptyState
          title="Start your application first"
          body="Your business details come before the payout account."
          action={<a href={STEP_HREF.start}>Start with your business</a>}
        />
      </SellFrame>
    );
  }
  return <PayoutChoice application={application.data} accounts={accounts.data} />;
}

function PayoutChoice({
  application,
  accounts,
}: {
  application: MerchantApplication;
  accounts: PayoutAccount[];
}): React.JSX.Element {
  const router = useRouter();
  const verified = accounts.filter((account) => account.status === 'VERIFIED');
  const checking = accounts.some((account) => account.status === 'PENDING_VERIFICATION');
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const save = useSaveMerchantDraft();
  const submit = useSubmitMerchantApplication();
  const resubmit = useResubmitMerchantApplication();
  const resend = phaseOf(application) === 'CHANGES_REQUESTED';
  const selected = chosen ?? verified[0]?.id;
  const sending = save.isPending || submit.isPending || resubmit.isPending;
  const ready = selected !== undefined && !checking && !sending;

  const confirm = async () => {
    if (selected === undefined) return;
    setProblem(undefined);
    try {
      await save.mutateAsync({ payoutAccountId: selected });
    } catch {
      setProblem('Couldn’t save your payout account. Check your connection and try again.');
      return;
    }
    try {
      await (resend ? resubmit : submit).mutateAsync(application.id);
      router.push(VERIFICATION_HREF);
    } catch (error) {
      setProblem(
        error instanceof ProblemError && error.status === 422
          ? 'Your application isn’t complete yet. Check the earlier steps and try again.'
          : 'Couldn’t send your application. Check your connection and try again.',
      );
    }
  };

  return (
    <SellFrame
      title="Payout Account"
      step={4}
      backHref={STEP_HREF['verify-business']}
      action={
        <>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button type="button" disabled={!ready} onClick={() => void confirm()}>
            {sending ? 'Sending…' : 'Confirm payout account'}
          </Button>
        </>
      }
    >
      {verified.length > 0 ? (
        <fieldset className="m-0 mb-[14px] border-0 p-0">
          <legend className="mb-[8px] text-[12px] font-semibold">Pay into</legend>
          {verified.map((account) => (
            <OptionCard
              key={account.id}
              name="payout-account"
              value={account.id}
              checked={selected === account.id}
              onChange={(event) => setChosen(event.target.value)}
              description={`${account.accountNumberMasked} · ${account.accountName ?? 'Name from your bank'}`}
            >
              {account.bankName ?? 'Bank account'}
            </OptionCard>
          ))}
        </fieldset>
      ) : checking ? (
        <Banner tone="info" icon={INFO_MARK} title="Checking with your bank">
          The bank confirms the account, and its name, before you can send your application. This takes a
          moment.
        </Banner>
      ) : (
        <PayoutForm
          onAdded={() => setProblem(undefined)}
          failed={accounts.find((a) => a.status === 'FAILED')}
        />
      )}
      <Banner tone="info" icon={INFO_MARK}>
        Must match your verified name — this is what keeps payouts from being redirected if your account is
        ever compromised.
      </Banner>
    </SellFrame>
  );
}

function PayoutForm({
  failed,
  onAdded,
}: {
  failed: PayoutAccount | undefined;
  onAdded: () => void;
}): React.JSX.Element {
  const banks = useBanks();
  const add = useAddPayoutAccount();
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const digits = number.replace(/\s/g, '');
  const ready = bankCode !== '' && /^\d{10}$/.test(digits) && !add.isPending;

  return (
    <section aria-label="Add a bank account">
      <SectionLabel>{failed === undefined ? 'Add a bank account' : 'Try another account'}</SectionLabel>
      {failed !== undefined && (
        <RiskBanner title={failed.bankName ?? 'Bank account'}>
          {failed.failureReason ?? 'Your bank couldn’t confirm this account.'}
        </RiskBanner>
      )}
      <Select
        label="Bank"
        value={bankCode}
        disabled={banks.isPending}
        onChange={(event) => setBankCode(event.target.value)}
      >
        <option value="">{banks.isPending ? 'Loading banks…' : 'Select your bank'}</option>
        {(banks.data ?? []).map((bank) => (
          <option key={bank.code} value={bank.code}>
            {bank.name}
          </option>
        ))}
      </Select>
      <TextField
        label="Account number"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        mono
        value={number}
        placeholder="10-digit account number"
        onChange={(event) => setNumber(event.target.value.replace(/[^\d]/g, ''))}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={!ready}
        onClick={() =>
          add.mutate(
            { bankCode, accountNumber: digits },
            {
              onSuccess: () => {
                setNumber('');
                onAdded();
              },
            },
          )
        }
      >
        {add.isPending ? 'Saving…' : 'Save payout account'}
      </Button>
      <p className="mt-[8px]">
        <Chip tone="verifying">Your bank checks the account</Chip>
      </p>
    </section>
  );
}
