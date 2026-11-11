'use client';

import type { PayoutAccount } from '@komtru/api-client';
import {
  useAddPayoutAccount,
  useBanks,
  usePayoutAccounts,
  useRemovePayoutAccount,
  useSetDefaultPayoutAccount,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  Chip,
  LoadFailed,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Select,
  Skeleton,
  TextField,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { ConfirmSheet } from '../trade/parts';
import { accountLabel, payoutProblem } from './format';
import { BankRow, PAYOUTS_HREF } from './parts';

/**
 * AB6: the accounts a seller is paid into. An account is added with a bank and a ten-digit number; the platform then
 * checks it with the bank (the list polls while it does) and the holder's name is the one the bank returns — the
 * seller never types it. Only a verified account can be the payout account automatic payouts go to.
 */
export function PayoutAccounts(): React.JSX.Element {
  const accounts = usePayoutAccounts();

  return (
    <ScreenColumn>
      <ScreenHeader title="Payout Account" backHref={PAYOUTS_HREF} backLabel="Back to payouts" />
      {accounts.isPending ? (
        <div role="status" aria-label="Loading your bank accounts" aria-busy="true">
          <Skeleton width="full" lines={2} />
        </div>
      ) : accounts.isError ? (
        <LoadFailed
          title="Couldn’t load your bank accounts"
          body="Check your connection and try again."
          onRetry={() => void accounts.refetch()}
        />
      ) : (
        <>
          {accounts.data.length > 0 && <AccountList accounts={accounts.data} />}
          <AddAccount first={accounts.data.length === 0} />
        </>
      )}
    </ScreenColumn>
  );
}

function AccountList({ accounts }: { accounts: PayoutAccount[] }): React.JSX.Element {
  const makeDefault = useSetDefaultPayoutAccount();
  const remove = useRemovePayoutAccount();
  const [removing, setRemoving] = useState<PayoutAccount | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const onMakeDefault = (account: PayoutAccount) => {
    setProblem(undefined);
    makeDefault.mutate(account.id, {
      onError: (error) => setProblem(payoutProblem(error, 'default-account')),
    });
  };
  const onRemove = () => {
    if (removing === undefined) return;
    setProblem(undefined);
    remove.mutate(removing.id, {
      onSettled: () => setRemoving(undefined),
      onError: (error) => setProblem(payoutProblem(error, 'remove-account')),
    });
  };

  return (
    <section aria-label="Your bank accounts" className="mb-[8px]">
      <SectionLabel>Your bank accounts</SectionLabel>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ul className="m-0 list-none p-0">
        {accounts.map((account) => (
          <li key={account.id} className="mb-[12px]">
            <AccountRow account={account} />
            <div className="-mt-[2px] flex gap-[16px] px-[2px]">
              {account.status === 'VERIFIED' && !account.isDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={makeDefault.isPending}
                  onClick={() => onMakeDefault(account)}
                >
                  Make this my payout account
                  <span className="sr-only">: {accountLabel(account)}</span>
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setRemoving(account)}>
                Remove <span className="sr-only">{accountLabel(account)}</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmSheet
        open={removing !== undefined}
        title={removing === undefined ? 'Remove this account?' : `Remove ${accountLabel(removing)}?`}
        confirm="Remove account"
        pending={remove.isPending}
        onConfirm={onRemove}
        onClose={() => setRemoving(undefined)}
      >
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          Payouts won’t be sent to it any more. Payouts already sent to it keep their receipts.
        </p>
      </ConfirmSheet>
    </section>
  );
}

/** One account as the platform has it: verified (and whether it is the payout account), being checked, or failed. */
function AccountRow({ account }: { account: PayoutAccount }): React.JSX.Element {
  const title = accountLabel(account);
  switch (account.status) {
    case 'VERIFIED':
      return (
        <BankRow
          bankName={account.bankName}
          title={title}
          sub={account.accountName ?? 'Verified by your bank'}
          selected={account.isDefault}
          trailing={
            account.isDefault ? (
              <Chip tone="protected">Payout account</Chip>
            ) : (
              <Chip tone="verified">Verified</Chip>
            )
          }
        />
      );
    case 'PENDING_VERIFICATION':
      return (
        <BankRow
          bankName={account.bankName}
          title={title}
          sub="Checking this account with your bank…"
          trailing={<Chip tone="verifying">Checking</Chip>}
        />
      );
    case 'FAILED':
    case 'DISABLED':
      return (
        <BankRow
          bankName={account.bankName}
          title={title}
          sub={account.failureReason ?? 'Your bank couldn’t confirm this account.'}
          risk
          trailing={<Chip tone="risk">Not verified</Chip>}
        />
      );
  }
}

function AddAccount({ first }: { first: boolean }): React.JSX.Element {
  const banks = useBanks();
  const add = useAddPayoutAccount();
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const digits = number.replace(/\s/g, '');
  const ready = bankCode !== '' && /^\d{10}$/.test(digits) && !add.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setProblem(undefined);
    add.mutate(
      { bankCode, accountNumber: digits },
      {
        onSuccess: () => {
          setBankCode('');
          setNumber('');
        },
        onError: (error) => setProblem(payoutProblem(error, 'add-account')),
      },
    );
  };

  return (
    <section aria-label="Add a bank account">
      {!first && <SectionLabel>Add a bank account</SectionLabel>}
      {banks.isError ? (
        <RiskBanner title="The list of banks didn’t load">
          <Button type="button" variant="ghost" onClick={() => void banks.refetch()}>
            Try again
          </Button>
        </RiskBanner>
      ) : (
        <form onSubmit={submit} noValidate>
          <Select
            label="Bank"
            value={bankCode}
            disabled={banks.isPending}
            onChange={(event) => {
              setBankCode(event.target.value);
              setProblem(undefined);
            }}
          >
            <option value="" disabled>
              {banks.isPending ? 'Loading banks…' : 'Choose your bank'}
            </option>
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
            value={number}
            className="font-mono"
            helper="The ten-digit NUBAN on your bank app or statement."
            onChange={(event) => {
              setNumber(event.target.value.replace(/[^\d]/g, ''));
              setProblem(undefined);
            }}
          />
          <p className="mt-[12px] text-[11px] leading-[1.5] text-trust-gray">
            The name on the account comes from your bank, not from what you type, and money is only paid into
            an account your bank has confirmed.
          </p>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <ActionStack>
            <Button type="submit" disabled={!ready}>
              {add.isPending ? 'Saving…' : 'Save payout account'}
            </Button>
          </ActionStack>
        </form>
      )}
    </section>
  );
}
