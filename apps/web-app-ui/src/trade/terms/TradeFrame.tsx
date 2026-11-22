'use client';

// The shell every one-trade screen in `terms/` shares: the header, then the trade read and the ways that can go
// wrong (loading, offline, not yours or not there, failed) drawn under that same header, so a failed read is never
// a dead end and each screen draws only its own content.
//
// "Not yours" and "not there" are one answer on purpose: the platform answers a non-party with the same 404 as a
// trade that does not exist (`requireParty`), so that the existence of someone else's trade is not disclosed. The
// screen says both things and does not pretend to know which.
import type { TradeView } from '@komtru/api-client';
import { useTrade } from '@komtru/api-client/react';
import { Button, EmptyState, LoadingScreen, ScreenColumn, ScreenHeader } from '@komtru/ui-kit';
import { isProblem, problemMessage } from '../format';

export function TradeFrame({
  id,
  title,
  loading,
  back,
  backLabel = 'Back to the trade',
  wide = false,
  children,
}: {
  id: string;
  /** The screen's own title. */
  title: string;
  /** What is being read ("the agreement"), for the loading label. */
  loading: string;
  /** Where the header's back arrow goes. */
  back: string;
  backLabel?: string;
  /** Lets the screen use a tablet or desktop window's width (DX-14) instead of a phone-width column. */
  wide?: boolean;
  children: (trade: TradeView) => React.ReactNode;
}): React.JSX.Element {
  const trade = useTrade(id);
  const body = (
    <>
      <ScreenHeader title={title} backHref={back} backLabel={backLabel} />
      <Content trade={trade} loading={loading}>
        {children}
      </Content>
    </>
  );
  return wide ? (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">{body}</div>
  ) : (
    <ScreenColumn>{body}</ScreenColumn>
  );
}

function Content({
  trade,
  loading,
  children,
}: {
  trade: ReturnType<typeof useTrade>;
  loading: string;
  children: (trade: TradeView) => React.ReactNode;
}): React.ReactNode {
  if (trade.isPending) return <LoadingScreen label={`Loading ${loading}`} />;
  if (trade.isError) {
    if (isProblem(trade.error, 'NOT_FOUND')) {
      return (
        <EmptyState
          tone="error"
          title="We can't find this trade"
          body="It may have been withdrawn, or it belongs to another account. Check you're signed in to the right one."
        />
      );
    }
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (
      <EmptyState
        tone="error"
        title={offline ? "You're offline" : "Couldn't open this trade"}
        body={
          offline
            ? "We can't reach Komtru, and this page hasn't been saved on this device. Reconnect and try again."
            : problemMessage(trade.error, 'Check your connection and try again.')
        }
        action={
          <Button type="button" onClick={() => void trade.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  return <>{children(trade.data)}</>;
}
