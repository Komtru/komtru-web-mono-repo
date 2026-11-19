'use client';

// CWT-S17 — "Resolution — Report One Item", item-level intake for a multi-item order.
//
// SEAM(F-069/F-073, orders), the same one CWT-S16 names: there is no order read, so there is no
// "this item" to describe and no unaffected sibling to reassure anyone about. The screen says so
// and offers the whole-trade report. Every sentence it would otherwise draw — "Item 2 / 2", "The
// iPhone 13 Pro is not affected", "This item's funds: Protected" — is a claim about money and
// fulfilment the platform cannot currently back, and the repo's standing rule is that a screen
// never asserts a financial state it has not read for that trade.
import { ActionStack, Button, NoteBanner } from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { reportIssueHref, tradeHref } from './routes';

const TITLE = 'Report an Issue';

export function ReportItem({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE} role="BUYER">
      {() => (
        <Frame title={TITLE} id={id}>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            Describe what happened with the item that went wrong.
          </p>

          <NoteBanner>
            This trade is a single item, so there is nothing to report separately. Report the trade and
            describe the problem in your own words — the case covers the whole payment either way.
          </NoteBanner>

          <ActionStack>
            <Button asChild>
              <a href={reportIssueHref(id)}>Report this trade</a>
            </Button>
            <Button asChild variant="ghost">
              <a href={tradeHref(id)}>Back to the trade</a>
            </Button>
          </ActionStack>
        </Frame>
      )}
    </TradeGate>
  );
}
