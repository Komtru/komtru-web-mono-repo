'use client';

import { useTradeActivity } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  SectionLabel,
  Skeleton,
  TermList,
  TermRow,
  VersionTimeline,
  type VersionStep,
} from '@komtru/ui-kit';
import type { TradeView } from '@komtru/api-client';
import { naira, whenLabel } from '../format';
import { versionSteps } from '../parts';
import { tabHref } from '../workspace-state';
import { NothingAgreed } from './AgreementScreen';
import { historySteps } from './history';
import { agreementHref } from './routes';
import { TradeFrame } from './TradeFrame';

/**
 * CWT-S02: earlier proposals stay visible. Who proposed each version and when comes from the trade's activity.
 * The platform returns only the accepted terms, so no earlier version has an amount; when the activity cannot
 * account for every version, the earlier ones read as superseded and nothing is drawn that the screen was not told.
 */
export function AgreementHistory({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeFrame
      id={id}
      title="Agreement History"
      loading="the agreement history"
      back={agreementHref(id)}
      backLabel="Back to the agreement"
    >
      {(trade) =>
        trade.terms === null || trade.acceptedAt === null ? (
          <NothingAgreed trade={trade} />
        ) : (
          <History trade={trade} accepted={trade.acceptedAt} />
        )
      }
    </TradeFrame>
  );
}

function History({ trade, accepted }: { trade: TradeView; accepted: string }): React.JSX.Element {
  const feed = useTradeActivity(trade.id);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const fromActivity = historySteps(trade, items);
  const steps: VersionStep[] =
    fromActivity ??
    versionSteps(trade).map((step, index, all) =>
      index === all.length - 1 && trade.terms !== null
        ? { ...step, detail: `${naira(trade.terms.itemAmountMinor)} · accepted by buyer and seller` }
        : step,
    );
  return (
    <>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        Earlier proposals remain visible without replacing the accepted version.
      </p>
      {feed.isPending ? (
        <div role="status" aria-label="Loading the versions" aria-busy="true">
          <Skeleton width="full" lines={3} />
        </div>
      ) : (
        <VersionTimeline aria-label="Versions of this agreement" steps={steps} />
      )}
      <SectionLabel>Acceptance</SectionLabel>
      <TermList aria-label="Acceptance">
        <TermRow label="Accepted">{whenLabel(accepted)}</TermRow>
        <TermRow label="Trade">{trade.tradeCode}</TermRow>
      </TermList>
      <ActionStack>
        <Button asChild>
          <a href={agreementHref(trade.id)}>View accepted terms</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'overview')}>Return to trade</a>
        </Button>
      </ActionStack>
    </>
  );
}
