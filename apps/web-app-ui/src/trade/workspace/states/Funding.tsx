'use client';

import { useDeliveryDeadline } from '@komtru/api-client/react';
import { ActionStack, CodeCard, SectionLabel, StatusHero, VersionTimeline } from '@komtru/ui-kit';
import { BACK_TO_TRADES, ItemSummary, versionSteps } from '../../parts';
import { stateCopy } from '../../workspace-copy';
import {
  BannerView,
  Deadline,
  FeeList,
  Fulfilment,
  FurtherViews,
  MoneyRows,
  NotInTheAppYet,
  type BodyProps,
} from '../shared';

/**
 * CWT-01, and TC-06 before it: the agreement is recorded and nobody has paid. The next step is the buyer's
 * funding, which is F-024.
 */
export function AwaitingFunding({ trade, role }: BodyProps): React.JSX.Element {
  const copy = stateCopy('PENDING_PAYMENT', role, { version: trade.terms?.versionNumber });
  return (
    <>
      {copy.hero && (
        <StatusHero tone="success" as="h2" title={copy.hero.title}>
          {copy.hero.body}
        </StatusHero>
      )}
      {copy.banner && <BannerView banner={copy.banner} />}
      <ItemSummary trade={trade} />
      <FeeList trade={trade} role={role} />
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      {/* SEAM(F-024): "Fund this trade" for the buyer goes here, above this line, when payment exists. */}
      <p className="mt-[12px] text-[11.5px] leading-[1.6] text-trust-gray">{copy.nextStep}</p>
      <CodeCard label="Trade Code" code={trade.tradeCode} className="mt-[16px]" />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </>
  );
}

/** CWT-02 (and Customer-3's buyer view): paid for, waiting on the seller to ship. */
export function FundsProtected({ trade, role }: BodyProps): React.JSX.Element {
  const deadline = useDeliveryDeadline(trade.id, true);
  const copy = stateCopy('FUNDED', role);
  return (
    <>
      {copy.banner && <BannerView banner={copy.banner} />}
      <Deadline
        label={copy.deadlineLabel ?? 'Ship by'}
        noun="delivery deadline"
        query={deadline}
        at={deadline.data?.deadline?.dueAt}
      />
      <MoneyRows trade={trade} role={role} held={copy.payoutHeld ?? ''} />
      <Fulfilment trade={trade} />
      {/* SEAM(F-026): the seller's "Prepare & dispatch" action goes here when shipping exists. */}
      {copy.seam !== undefined && <NotInTheAppYet>{copy.seam}</NotInTheAppYet>}
      <FurtherViews trade={trade} />
    </>
  );
}
