'use client';

// TW-01: the trade is agreed and nobody has paid. The reference's order: the do-not-dispatch guard, the agreed
// terms with the payment status as the platform last reported it, then the one next step for this person.
import type { TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  CodeCard,
  SectionLabel,
  StatusHero,
  TermList,
  TermRow,
  VersionTimeline,
  WarnBanner,
} from '@komtru/ui-kit';
import { hoursLabel, naira } from '../format';
import { BACK_TO_TRADES, ItemSummary, versionSteps } from '../parts';
import { stateCopy } from '../workspace-copy';
import { fundHref, tabHref, type TradeRole } from '../workspace-state';
import { BannerView, FeeList } from '../workspace/shared';
import { deliveryWords } from './AgreementScreen';
import { policiesHref } from './routes';

export function AwaitingFundingBody({
  trade,
  role,
}: {
  trade: TradeView;
  role: TradeRole;
}): React.JSX.Element {
  const copy = stateCopy('PENDING_PAYMENT', role, { version: trade.terms?.versionNumber });
  const { terms } = trade;
  const category = trade.categoryName;
  return (
    <>
      {copy.hero && (
        <StatusHero tone="success" as="h2" title={copy.hero.title}>
          {copy.hero.body}
        </StatusHero>
      )}
      {copy.banner && <BannerView banner={copy.banner} />}
      <WarnBanner title="Do not dispatch until payment is confirmed">
        Funding or expiry status is confirmed by Komtru&apos;s trade service.
      </WarnBanner>
      <ItemSummary trade={trade} />
      {terms !== null && (
        <>
          <SectionLabel>Agreed terms</SectionLabel>
          <TermList aria-label="Agreed terms">
            <TermRow label="Item price">{naira(terms.itemAmountMinor)}</TermRow>
            <TermRow label="Delivery">{deliveryWords(trade)}</TermRow>
            <TermRow label="Inspection">
              {category === null
                ? hoursLabel(terms.inspectionWindowHours)
                : `${category} · ${hoursLabel(terms.inspectionWindowHours)}`}
            </TermRow>
            <TermRow label="Payment status">Not yet confirmed</TermRow>
          </TermList>
        </>
      )}
      <FeeList trade={trade} role={role} />
      <SectionLabel>Agreement history</SectionLabel>
      <VersionTimeline aria-label="Versions of this agreement" steps={versionSteps(trade)} />
      <SectionLabel>Your next step</SectionLabel>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">{copy.nextStep}</p>
      <ActionStack>
        {role === 'BUYER' && (
          <Button asChild>
            <a href={fundHref(trade.id)}>Continue to funding</a>
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'actions')}>Withdraw from trade</a>
        </Button>
        <Button asChild variant="ghost">
          <a href={policiesHref(trade.id)}>Trade policies</a>
        </Button>
      </ActionStack>
      <CodeCard label="Trade Code" code={trade.tradeCode} className="mt-[16px]" />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </>
  );
}
