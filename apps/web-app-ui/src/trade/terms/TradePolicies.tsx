'use client';

import {
  ActionStack,
  Button,
  NoteBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { tabHref } from '../workspace-state';
import { TradeFrame } from './TradeFrame';

/**
 * TW-04: cancellation, return and refund in one place. The words are the reference's, which are the platform's
 * policy and not data on any one trade; the trade is read so the screen has somewhere to go back to and says the
 * right thing when the trade cannot be opened.
 */
export function TradePolicies({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeFrame id={id} title="Trade Policies" loading="the trade policies" back={`/trade/${id}`}>
      {(trade) => (
        <ScreenColumn>
          <ScreenHeader
            title="Trade Policies"
            backHref={tabHref(trade.id, 'overview')}
            backLabel="Back to the trade"
          />
          <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
            The applicable terms are shown with the trade. Final outcomes depend on state, evidence and
            policy.
          </p>
          <SectionLabel>Cancellation</SectionLabel>
          <TermList aria-label="Cancellation">
            <TermRow label="Before shipment">Cancellation may be requested</TermRow>
            <TermRow label="After shipment">Use the return / dispute flow</TermRow>
          </TermList>
          <SectionLabel>Inspection &amp; refund</SectionLabel>
          <TermList aria-label="Inspection and refund">
            <TermRow label="Electronics">48h minimum</TermRow>
            <TermRow label="Fashion &amp; Luxury">24h minimum</TermRow>
            <TermRow label="Full-refund grounds">Damaged, not as described, incomplete</TermRow>
          </TermList>
          <NoteBanner>
            You can ask for more inspection time with a reason (up to 72h Electronics, 48h Fashion &amp;
            Luxury). Eligibility and any refund follow the actual trade state.
          </NoteBanner>
          <ActionStack>
            <Button asChild>
              <a href={tabHref(trade.id, 'overview')}>Continue</a>
            </Button>
          </ActionStack>
        </ScreenColumn>
      )}
    </TradeFrame>
  );
}
