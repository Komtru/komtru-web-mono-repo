'use client';

// CWT-S16 — "Resolution — Choose the Item", for multi-item orders only.
//
// SEAM(F-069/F-073, orders): the platform has no multi-item order read today — a trade is one
// item, and `Dispute.orderId` is always null. Rather than draw a picker over invented items, this
// screen says plainly that the order view is not here yet and sends the person to the
// whole-order report, which is the one true thing it can offer. When orders arrive, the items
// come from the order read and the rest of this screen is already drawn.
import { ActionStack, Button, NoteBanner, SectionLabel } from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { reportIssueHref, tradeHref } from './routes';

const TITLE = 'Report an Issue';

export function ChooseItem({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE} role="BUYER">
      {() => (
        <Frame title={TITLE} id={id}>
          <SectionLabel>Which item?</SectionLabel>
          <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
            Reporting one item of a multi-item order pauses only that item — the rest settles normally.
          </p>

          <NoteBanner>
            Multi-item orders aren’t in the app yet, so there is nothing to choose between here. Report the
            issue against the whole trade and say in your own words which part of it went wrong.
          </NoteBanner>

          <ActionStack>
            <Button asChild>
              <a href={reportIssueHref(id)}>Report the whole trade</a>
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
