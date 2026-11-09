'use client';

import { useAddresses, useCounterTrade, useTrade } from '@komtru/api-client/react';
import { nairaToKobo } from '@komtru/shared-types';
import { ActionStack, Button, CounterDiffRow, ScreenHeader, SectionLabel, TextField } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AddressPicker } from './AddressPicker';
import { addressLine, isProblem, naira, problemMessage } from './format';
import { Column, LoadFailed, LoadingScreen, NoteBanner, RiskBanner } from './parts';

const asNairaText = (minor: string): string => {
  const kobo = BigInt(minor);
  const whole = (kobo / 100n).toString();
  const fraction = (kobo % 100n).toString().padStart(2, '0');
  return fraction === '00' ? whole : `${whole}.${fraction}`;
};

const parse = (text: string): bigint | undefined => {
  try {
    const kobo = nairaToKobo(text);
    return kobo > 0n ? kobo : undefined;
  } catch {
    return undefined;
  }
};

/**
 * TC-05. A counter-proposal changes only what the person edits and shows each change as the old value
 * struck through above the new one, so the other party reads a difference and not a second contract.
 * The turn flips when it is sent, and `expectedRevision` makes a counter against a trade that moved
 * meanwhile fail rather than land on terms the person never saw.
 */
export function ProposeChange({ id }: { id: string }): React.JSX.Element {
  const router = useRouter();
  const trade = useTrade(id);
  const addresses = useAddresses();
  const counter = useCounterTrade();
  const [amount, setAmount] = useState<string | undefined>(undefined);
  const [changeAddress, setChangeAddress] = useState(false);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (trade.isPending) {
    return (
      <Column>
        <ScreenHeader title="Propose a Change" backHref={`/trade/${id}`} />
        <LoadingScreen label="Loading the trade" />
      </Column>
    );
  }
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn't open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }

  const view = trade.data;
  const terms = view.terms;
  if (view.awaiting !== 'YOU' || terms === null) {
    return (
      <Column>
        <ScreenHeader title="Propose a Change" backHref={`/trade/${id}`} />
        <NoteBanner>
          It isn&apos;t your turn on this trade, so there&apos;s nothing to change right now.
        </NoteBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={`/trade/${id}`}>Back to the trade</a>
          </Button>
        </ActionStack>
      </Column>
    );
  }

  const typed = amount ?? asNairaText(terms.itemAmountMinor);
  const kobo = parse(typed);
  const priceChanged = kobo !== undefined && kobo.toString() !== terms.itemAmountMinor;
  const ownSide = view.yourRole === 'BUYER' ? terms.deliveryAddress : terms.shipsFromAddress;
  const chosenAddress = changeAddress
    ? addresses.data?.find((address) => address.id === addressId)
    : undefined;
  const addressChanged = chosenAddress !== undefined;
  const proposer = view.yourRole === 'BUYER' ? 'seller' : 'buyer';

  const send = () => {
    if (kobo === undefined || (!priceChanged && !addressChanged)) return;
    setProblem(undefined);
    counter.mutate(
      {
        id,
        expectedRevision: view.statusRevision,
        ...(priceChanged ? { itemAmountMinor: kobo.toString() } : {}),
        ...(addressChanged && addressId !== null ? { addressId } : {}),
      },
      {
        onSuccess: () => {
          router.push(`/trade/${id}`);
        },
        onError: (error) => setProblem(problemMessage(error, "We couldn't send that change. Try again.")),
      },
    );
  };

  return (
    <Column>
      <ScreenHeader title="Propose a Change" backHref={`/trade/${id}`} />
      <NoteBanner>
        Only the terms you change are different. The {proposer} must review the revised agreement.
      </NoteBanner>
      <TextField
        label="Item price"
        inputMode="decimal"
        value={typed}
        onChange={(event) => {
          setAmount(event.target.value);
        }}
        invalid={kobo === undefined}
        {...(kobo === undefined ? { helper: 'Enter the price in naira, for example 452,000' } : {})}
      />
      <label className="mb-[16px] flex items-center gap-[10px] text-[12.5px]">
        <input
          type="checkbox"
          checked={changeAddress}
          onChange={(event) => {
            setChangeAddress(event.target.checked);
          }}
          className="h-[16px] w-[16px] accent-trust-indigo"
        />
        Use a different {view.yourRole === 'BUYER' ? 'delivery address' : 'ships-from address'}
      </label>
      {changeAddress && (
        <AddressPicker
          label={view.yourRole === 'BUYER' ? 'Delivery address' : 'Ships from'}
          value={addressId}
          onChange={setAddressId}
        />
      )}
      <SectionLabel>What&apos;s changing</SectionLabel>
      {!priceChanged && !addressChanged && (
        <p className="text-[12.5px] text-slate">
          Nothing yet. Change the price or the address to send a counter-proposal.
        </p>
      )}
      {priceChanged && (
        <CounterDiffRow
          label="Item price"
          before={naira(terms.itemAmountMinor)}
          after={naira(kobo.toString())}
          beforeCaption={`${proposer} proposed`}
          afterCaption="your counter"
        />
      )}
      {chosenAddress !== undefined && (
        <CounterDiffRow
          label={view.yourRole === 'BUYER' ? 'Delivery to' : 'Ships from'}
          before={ownSide === null ? 'No address yet' : addressLine(ownSide)}
          after={chosenAddress.streetLine}
          afterCaption="your counter"
        />
      )}
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button
          type="button"
          onClick={send}
          disabled={counter.isPending || (!priceChanged && !addressChanged)}
        >
          {counter.isPending ? 'Sending…' : 'Send counter-proposal'}
        </Button>
        <Button asChild variant="secondary">
          <a href={`/trade/${id}`}>Discard changes</a>
        </Button>
      </ActionStack>
    </Column>
  );
}
