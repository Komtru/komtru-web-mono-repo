'use client';

// What the six delivery and evidence sheets (F-028) share: the frame with its way back to the trade, and the
// gate that reads the trade and says plainly when it cannot be read (loading, offline, not found) or when this
// side of the trade has no business on the screen (permission denied).
import type { TradeView } from '@komtru/api-client';
import { useTrade } from '@komtru/api-client/react';
import { ActionStack, Button, LoadFailed, LoadingScreen, ScreenColumn, ScreenHeader } from '@komtru/ui-kit';
import { useOnline } from '../../shell/OfflineStatus';
import { isProblem, problemMessage } from '../format';
import type { TradeRole } from '../workspace-state';

export const tradeHref = (id: string): string => `/trade/${id}`;

export function Frame({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={tradeHref(id)} backLabel="Back to the trade" />
      {children}
    </ScreenColumn>
  );
}

/** A screen with nothing to offer this person here: the reason, and the way back. */
export function Refusal({ id, title, why }: { id: string; title: string; why: string }): React.JSX.Element {
  return (
    <Frame title={title} id={id}>
      <p role="status" className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
        {why}
      </p>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** A failed read: in the words of the connection when the device is offline, the platform's otherwise. */
export function ReadFailed({
  error,
  noun,
  onRetry,
}: {
  error: unknown;
  noun: string;
  onRetry?: () => void;
}): React.JSX.Element {
  const online = useOnline();
  return (
    <LoadFailed
      title={online ? `Couldn’t load ${noun}` : 'You’re offline'}
      body={
        online
          ? problemMessage(error, 'Check your connection and try again.')
          : `We can’t reach Komtru to load ${noun}. It will load when you’re back online.`
      }
      {...(onRetry === undefined || isProblem(error, 'NOT_FOUND') ? {} : { onRetry })}
    />
  );
}

/**
 * Reads the trade and hands it to `children`. `role` limits the screen to one side of the trade; the other side
 * is told so, with no control to press.
 */
export function TradeGate({
  id,
  title,
  role,
  deniedWhy,
  children,
}: {
  id: string;
  title: string;
  role?: TradeRole;
  deniedWhy?: string;
  children: (trade: TradeView) => React.ReactNode;
}): React.JSX.Element {
  const trade = useTrade(id);
  if (trade.isPending) {
    return (
      <Frame title={title} id={id}>
        <LoadingScreen label="Loading the trade" />
      </Frame>
    );
  }
  if (trade.isError) {
    return <ReadFailed error={trade.error} noun="this trade" onRetry={() => void trade.refetch()} />;
  }
  const view = trade.data;
  if (role !== undefined && view.yourRole !== role) {
    return (
      <Refusal
        id={id}
        title={title}
        why={deniedWhy ?? `Only the ${role === 'SELLER' ? 'seller' : 'buyer'} can use this screen.`}
      />
    );
  }
  return <>{children(view)}</>;
}
