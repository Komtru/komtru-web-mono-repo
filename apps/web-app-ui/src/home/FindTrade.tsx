'use client';

import { getTradeByCode, ProblemError } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import { TRADE_CODE_EXAMPLE, type TradeByCodeResponse } from '@komtru/shared-types';
import {
  Button,
  Chip,
  CodeCard,
  EmptyState,
  LoadFailed,
  NoteBanner,
  PartyStrip,
  ScreenColumn,
  ScreenHeader,
  TextField,
} from '@komtru/ui-kit';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { describeTrade, initialsOf, partyName, problemMessage } from '../trade/format';
import { tradeCodeOf } from './classify';

const INVALID = `That isn't a Trade Code. A Trade Code looks like ${TRADE_CODE_EXAMPLE}.`;

/**
 * Find a Trade by its code (F1 and F2): the way to verify a trade without trusting the link someone sent.
 *
 * The code is resolved once, by `GET /trades/by-code/:code`. A party is shown the trade and can open it; an invitee
 * is shown who invited them and is sent to the trade module's claim screen, which owns taking a place. A code the
 * person is neither a party to nor invited to gets the same "not found" the platform gives a code that does not
 * exist, so this screen cannot tell the two apart and does not try to. The platform allows ten tries a minute, so
 * nothing here retries or refetches on focus on its own.
 */
export function FindTrade({ initialCode }: { initialCode?: string }): React.JSX.Element {
  const client = useApiClient();
  const [typed, setTyped] = useState(initialCode ?? '');
  const [submitted, setSubmitted] = useState<string | undefined>(
    initialCode === undefined ? undefined : tradeCodeOf(initialCode),
  );
  const [invalid, setInvalid] = useState(initialCode !== undefined && submitted === undefined);

  const lookup = useQuery({
    queryKey: ['trades', 'by-code', submitted],
    queryFn: ({ signal }) => client.call(getTradeByCode, { params: { code: submitted ?? '' } }, { signal }),
    enabled: submitted !== undefined,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  return (
    <ScreenColumn>
      <ScreenHeader title="Find a Trade" backHref="/home" />
      <NoteBanner>
        If a seller sent you a link instead of a code, be careful. Always verify a Trade by searching its code
        here, not by tapping an unfamiliar link.
      </NoteBanner>

      <form
        className="mt-[16px]"
        onSubmit={(event) => {
          event.preventDefault();
          const code = tradeCodeOf(typed);
          setInvalid(code === undefined);
          setSubmitted(code);
        }}
        noValidate
      >
        <TextField
          mono
          label="Enter the seller's Trade Code"
          name="code"
          placeholder="KMT-XXXXXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setInvalid(false);
          }}
          invalid={invalid}
          helper={invalid ? INVALID : "Ask the seller for this. It's shown on every Trade they create."}
        />
        <div className="mt-[12px]">
          <Button type="submit">Find Trade</Button>
        </div>
      </form>

      <div className="mt-[16px]">
        {submitted !== undefined && <Result code={submitted} lookup={lookup} />}
      </div>
    </ScreenColumn>
  );
}

function Result({
  code,
  lookup,
}: {
  code: string;
  lookup: UseQueryResult<TradeByCodeResponse, Error>;
}): React.JSX.Element {
  if (lookup.isPending) {
    return (
      <div role="status" aria-label="Finding the trade" aria-busy="true">
        <p className="text-[12px] text-slate">Finding the trade…</p>
      </div>
    );
  }

  if (lookup.isError) {
    const error = lookup.error;
    if (error instanceof ProblemError && error.status === 404) {
      return (
        <EmptyState
          title="No trade found for you"
          body="Check the code. If someone invited you, sign in with the phone number or email they used."
        />
      );
    }
    if (error instanceof ProblemError && error.status === 429) {
      return (
        <EmptyState
          tone="error"
          title="Too many tries"
          body={problemMessage(error, 'Wait a minute and try again.')}
        />
      );
    }
    return (
      <LoadFailed
        title="Couldn't find that trade"
        body={problemMessage(error, 'Check your connection and try again.')}
        onRetry={() => void lookup.refetch()}
      />
    );
  }

  const { access, trade, counterparty } = lookup.data;
  const name = counterparty === null ? undefined : partyName(counterparty);
  const strip =
    name === undefined ? null : <PartyStrip name={name} initials={initialsOf(name.replace(/^@/, ''))} />;

  if (access === 'INVITEE') {
    return (
      <section aria-label="Trade invitation">
        <NoteBanner>
          {name ?? 'Someone'} has invited you to a trade
          {trade.categoryName === null ? '' : ` in ${trade.categoryName}`}. You can see it because you signed
          up with the phone number or email the invitation was sent to.
        </NoteBanner>
        {strip}
        <CodeCard label="Trade Code" code={trade.tradeCode} />
        <p className="mb-[16px] text-[11.5px] leading-[1.6] text-slate">
          The terms, the price and the fees are not shown until you take your place.
        </p>
        <Button asChild>
          <a href={`/trades/${trade.tradeCode}`}>Review the invitation</a>
        </Button>
      </section>
    );
  }

  const state = describeTrade({ status: trade.status, attention: null, tradeCode: trade.tradeCode });
  return (
    <section aria-label="Trade found">
      <div className="mb-[12px]">
        <Chip tone="verified">Verified Trade — found on Komtru</Chip>
      </div>
      <CodeCard label="Trade Code" code={code} />
      {strip}
      <p className="mb-[8px] mt-[12px] flex items-center gap-[8px] text-[12px] text-slate">
        Status
        <Chip tone={state.tone}>{state.label}</Chip>
      </p>
      {trade.categoryName !== null && (
        <p className="mb-[16px] text-[12px] text-slate">{`Category: ${trade.categoryName}`}</p>
      )}
      <Button asChild>
        <a href={`/trade/${trade.id}`}>Open trade</a>
      </Button>
    </section>
  );
}
