'use client';

// The shell every one-trade screen in `terms/` shares: it reads the trade and draws the four ways that can go
// wrong (loading, offline, refused, failed) so each screen draws only what it is for. Nothing here is a trade
// screen's own content.
import type { TradeView } from '@komtru/api-client';
import { useTrade } from '@komtru/api-client/react';
import { LoadFailed, LoadingScreen, ScreenColumn, ScreenHeader } from '@komtru/ui-kit';
import { isProblem, problemMessage } from '../format';

export function TradeFrame({
  id,
  title,
  loading,
  back,
  children,
}: {
  id: string;
  /** The header while loading: the screen's own title. */
  title: string;
  /** What is being read ("the agreement"), for the loading label. */
  loading: string;
  back: string;
  children: (trade: TradeView) => React.ReactNode;
}): React.JSX.Element {
  const trade = useTrade(id);
  if (trade.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title={title} backHref={back} backLabel="Back to the trade" />
        <LoadingScreen label={`Loading ${loading}`} />
      </ScreenColumn>
    );
  }
  if (trade.isError) {
    if (isProblem(trade.error, 'FORBIDDEN')) {
      return (
        <LoadFailed
          title="This trade isn't yours to open"
          body="Only the buyer and the seller of a trade can see it. Check you're signed in to the right account."
        />
      );
    }
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (
      <LoadFailed
        title={offline ? "You're offline" : "Couldn't open this trade"}
        body={
          offline
            ? "We can't reach Komtru, and this page hasn't been saved on this device. Reconnect and try again."
            : problemMessage(trade.error, 'Check your connection and try again.')
        }
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  return <>{children(trade.data)}</>;
}
