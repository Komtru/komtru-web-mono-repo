'use client';

import { getTradeByCode, ProblemError } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import { tradeCodeSchema, TRADE_CODE_EXAMPLE } from '@komtru/shared-types';
import {
  ActionStack,
  Button,
  CodeCard,
  EmptyState,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  PartyStrip,
  ScreenColumn,
  ScreenHeader,
} from '@komtru/ui-kit';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ClaimPanel } from './ClaimPanel';
import { LinkNotFound } from '../system/LinkNotFound';
import { initialsOf, partyName, problemMessage } from './format';

const BACK = (
  <Button asChild variant="secondary">
    <a href="/trades">Back to your trades</a>
  </Button>
);

/**
 * A trade opened from its code (a typed code, or the link a sender shared).
 *
 * The platform answers a party and the person the trade invited, and everyone else with the same
 * "not found" it gives for a code that does not exist, so this screen cannot tell a wrong code from
 * someone else's trade and does not try to: a 404 is "no trade found for you", worded to say neither
 * "forbidden" nor "it exists". That route allows ten tries a minute, so nothing here retries on its own.
 *
 * An invitee only gets this far after signing up with the phone number or email the invitation was sent
 * to. A link or a code is not a key, and the copy says so rather than implying it is.
 */
export function TradeByCode({ typed }: { typed: string }): React.JSX.Element {
  const router = useRouter();
  const client = useApiClient();
  const parsed = tradeCodeSchema.safeParse(typed);
  const code = parsed.success ? parsed.data : undefined;

  const lookup = useQuery({
    queryKey: ['trades', 'by-code', code],
    queryFn: ({ signal }) => client.call(getTradeByCode, { params: { code: code ?? '' } }, { signal }),
    enabled: code !== undefined,
    // Ten a minute: a failed lookup is never silently repeated, and a window refocus is not a retry.
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const tradeId = lookup.data?.access === 'PARTY' ? lookup.data.trade.id : undefined;
  useEffect(() => {
    if (tradeId !== undefined) router.replace(`/trade/${tradeId}`);
  }, [tradeId, router]);

  if (code === undefined) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Trade Code" backHref="/trades" />
        <EmptyState
          title="That isn't a Trade Code"
          body={`A Trade Code looks like ${TRADE_CODE_EXAMPLE}. Check it and try again.`}
          action={BACK}
        />
      </ScreenColumn>
    );
  }
  if (lookup.isPending || tradeId !== undefined) return <LoadingScreen label="Opening the trade" />;

  if (lookup.isError) {
    const missing = lookup.error instanceof ProblemError && lookup.error.status === 404;
    // SP-M19. The platform answers a code that does not exist and a trade that is not this person's the same way, and so
    // does this: the screen never says which.
    if (missing) return <LinkNotFound />;
    return (
      <LoadFailed
        title="Couldn't open that trade"
        body={problemMessage(lookup.error, 'Check your connection and try again.')}
        {...(lookup.error instanceof ProblemError && lookup.error.status === 429
          ? {}
          : { onRetry: () => void lookup.refetch() })}
      />
    );
  }

  // The caller is the person this trade invited, and has not taken their place yet.
  const { trade, counterparty } = lookup.data;
  return (
    <ScreenColumn>
      <ScreenHeader title="You're invited" backHref="/trades" />
      <NoteBanner>
        {counterparty === null ? 'Someone has' : `${partyName(counterparty)} has`} invited you to a trade
        {trade.categoryName === null ? '' : ` in ${trade.categoryName}`}. You can see it because you signed up
        with the phone number or email the invitation was sent to; a link or a code on its own doesn&apos;t
        open anyone&apos;s trade.
      </NoteBanner>
      {counterparty !== null && (
        <PartyStrip
          name={partyName(counterparty)}
          initials={initialsOf(partyName(counterparty).replace(/^@/, ''))}
        />
      )}
      <CodeCard label="Trade Code" code={trade.tradeCode} />
      <p className="mb-[16px] text-[11.5px] leading-[1.6] text-slate">
        The terms, the price and the fees aren&apos;t shown until you take your place. Taking it needs a saved
        address.
      </p>
      <ClaimPanel
        tradeId={trade.id}
        role={trade.yourRole}
        onClaimed={() => {
          router.push(`/trade/${trade.id}`);
        }}
      />
      <ActionStack>{BACK}</ActionStack>
    </ScreenColumn>
  );
}
