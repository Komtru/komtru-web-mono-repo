'use client';

import { listStates } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import { Button, CountdownStrip, NoteBanner, ReadyBanner, StatusHero, WarnBanner } from '@komtru/ui-kit';
import { useQuery } from '@tanstack/react-query';
import { EntryFrame, TrustNote } from '../entry/components/EntryFrame';
import { useOnline } from '../shell/OfflineStatus';
import { Loading } from '../account/states';

const lagosClock = (at: number): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));

/**
 * SP-M14: what someone sees during an incident, plain and specific about what to do and not do.
 *
 * Komtru has no incident feed, so this page does not announce one. It asks the platform a small public question (the
 * list of states, which needs the database) and says what the answer was: it answered, or it did not. The reference's
 * named cause ("bank payments are taking longer"), its list of affected Trades and its paused deadlines are all things
 * only an incident feed could know, so none of them is claimed. What stays is what is true of any outage: it is not the
 * person's doing, a payment already made should not be made again before the Trade is checked, and a Trade already
 * funded is not changed by this page.
 */
export function ServiceNotice(): React.JSX.Element {
  const client = useApiClient();
  const online = useOnline();
  const check = useQuery({
    queryKey: ['system', 'status'],
    queryFn: ({ signal }) => client.call(listStates, { query: { limit: 1 } }, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const checkedAt = Math.max(check.dataUpdatedAt, check.errorUpdatedAt);
  const again = (
    <Button type="button" variant="ghost" disabled={check.isFetching} onClick={() => void check.refetch()}>
      {check.isFetching ? 'Checking…' : 'Check again'}
    </Button>
  );

  return (
    <EntryFrame
      title="Service Notice"
      back="/"
      footer={
        <Button asChild variant="secondary">
          <a href="/trades">Back to Trades</a>
        </Button>
      }
    >
      {check.isPending ? (
        <Loading label="Checking Komtru" />
      ) : !online ? (
        <>
          <StatusHero tone="warning" title="You’re offline">
            Your device has no connection, so we can’t tell whether Komtru is working. Nothing here has
            changed.
          </StatusHero>
          {again}
        </>
      ) : check.isError ? (
        <>
          {checkedAt > 0 && (
            <CountdownStrip>Checked {lagosClock(checkedAt)} · we’re working on it</CountdownStrip>
          )}
          <StatusHero tone="warning" title="Komtru is having trouble">
            Some things may be slow or unavailable. This isn’t caused by anything you did.
          </StatusHero>
          <WarnBanner title="What this means for you">
            Money already held for a Trade stays held. A Trade you’ve already agreed isn’t changed by this.
          </WarnBanner>
          <TrustNote>If you’ve paid, please don’t pay again. Check the Trade first.</TrustNote>
          <TrustNote>
            New payments and updates may take longer, or not go through until this clears.
          </TrustNote>
          {again}
        </>
      ) : (
        <>
          {checkedAt > 0 && <CountdownStrip>Checked {lagosClock(checkedAt)}</CountdownStrip>}
          <StatusHero tone="success" title="Komtru is working">
            We couldn’t find a problem just now. If something still isn’t loading, try again in a minute.
          </StatusHero>
          <ReadyBanner title="Nothing here needs you to do anything">
            If you’re still stuck, the problem may be your connection rather than ours.
          </ReadyBanner>
          <NoteBanner>This page checks each time you open it. There is no list of past incidents.</NoteBanner>
          {again}
        </>
      )}
    </EntryFrame>
  );
}
