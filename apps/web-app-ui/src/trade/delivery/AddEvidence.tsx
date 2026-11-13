'use client';

import { ActionStack, Button, NoteBanner } from '@komtru/ui-kit';
import { evidenceHref } from '../workspace-state';
import { Frame, TradeGate, tradeHref } from './parts';

const TITLE = 'Add Evidence';

/**
 * CWT-S13 (SEAM). The reference lets a person choose an event and attach photos and video to the trade record
 * or a case. The platform has no call that attaches evidence to a trade or a case for the parties (files can be
 * uploaded, but nothing links them to a trade; case evidence is staff-side), so no category list, file picker
 * or Submit button is drawn: a control that could not do what it says is worse than none. When the platform
 * adds the call, this screen becomes the reference's form.
 */
export function AddEvidence({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {(trade) => (
        <Frame title={TITLE} id={trade.id}>
          <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
            Choose the event and attach the media that supports your trade record or case.
          </p>
          <NoteBanner title="Not in the app yet">
            Adding photos and video to a trade isn’t available yet. The proof and waybill receipt already
            given are kept with the trade, and you can browse them by event.
          </NoteBanner>
          <ActionStack className="mt-[16px]">
            <Button asChild>
              <a href={evidenceHref(trade.id)}>View trade evidence</a>
            </Button>
            <Button asChild variant="secondary">
              <a href={tradeHref(trade.id)}>Back to trade</a>
            </Button>
          </ActionStack>
        </Frame>
      )}
    </TradeGate>
  );
}
