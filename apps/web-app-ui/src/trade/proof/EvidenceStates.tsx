'use client';

// DX-38 and TX-22: the evidence a Trade keeps, in the three states the reference draws. Before you accept (the seller's
// proof as it was shown), During the Trade (what either side added, fixed and with who and when) and After it's
// complete (what the Trade keeps). A desktop draws the three side by side; a tablet draws one at a time behind a
// segmented control. Both are the groups the phone's `Trail` draws, arranged (F-069, F-073).
import type { TradeView } from '@komtru/api-client';
import type { useInspection } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner } from '@komtru/ui-kit';
import { useState } from 'react';
import { Panel } from '../workspace/layout';
import type { Viewport } from '../workspace/viewport';
import { AddedDuringTrade, KeptSummary, SellerProofSection } from './EvidenceTrail';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

const COMPLETE = new Set(['COMPLETED', 'SETTLED', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED']);

const STATES = [
  { id: 'before', label: 'Before you accept' },
  { id: 'during', label: 'During the Trade' },
  { id: 'after', label: 'After it’s complete' },
] as const;
type StateId = (typeof STATES)[number]['id'];

const PILL =
  'flex-1 rounded-full border-[1.5px] border-solid px-[12px] py-[8px] text-[12px] font-semibold focus-visible:outline-[2.5px] focus-visible:outline-trust-indigo focus-visible:outline-offset-[2px]';

function Body({ id, trade, read }: { id: StateId; trade: TradeView; read: Read }): React.JSX.Element {
  switch (id) {
    case 'before':
      return (
        <>
          <SellerProofSection trade={trade} read={read} heading={false} />
          <p className="m-0 text-[11.5px] leading-[1.6] text-trust-gray">
            This is the seller’s proof as it was when the Trade was agreed. It can’t be changed now.
          </p>
        </>
      );
    case 'during':
      return (
        <>
          <AddedDuringTrade trade={trade} read={read} />
          <p className="m-0 text-[11.5px] leading-[1.6] text-trust-gray">
            Nothing can be edited or deleted. New items are added with who and when.
          </p>
        </>
      );
    case 'after':
      return COMPLETE.has(trade.status) ? (
        <>
          <KeptSummary trade={trade} read={read} heading={false} />
          <ActionStack>
            <Button asChild variant="secondary">
              <a href={`/trade/${trade.id}/documents`}>Receipt &amp; documents</a>
            </Button>
          </ActionStack>
        </>
      ) : (
        <NoteBanner title="The record is there once the Trade is complete">
          Until then, what the Trade holds so far is under During the Trade.
        </NoteBanner>
      );
  }
}

/** The three states of a Trade's evidence for a tablet or a desktop. A phone draws `Trail` and never reaches this. */
export function EvidenceAcross({
  trade,
  read,
  viewport,
}: {
  trade: TradeView;
  read: Read;
  viewport: Exclude<Viewport, 'mobile'>;
}): React.JSX.Element {
  const [shown, setShown] = useState<StateId>(COMPLETE.has(trade.status) ? 'after' : 'during');
  if (viewport === 'desktop') {
    return (
      <div className="grid grid-cols-3 items-start gap-[16px]">
        {STATES.map(({ id, label }) => (
          <Panel key={id} title={label}>
            <Body id={id} trade={trade} read={read} />
          </Panel>
        ))}
      </div>
    );
  }
  const current = STATES.find((state) => state.id === shown) ?? STATES[1];
  return (
    <>
      <div
        role="group"
        aria-label="Which state of the evidence to look at"
        className="mb-[16px] flex gap-[8px]"
      >
        {STATES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={shown === id}
            onClick={() => {
              setShown(id);
            }}
            className={`${PILL} ${
              shown === id
                ? 'border-trust-indigo bg-trust-indigo-soft text-trust-indigo'
                : 'border-border-hairline bg-surface-primary text-slate'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Panel title={current.label}>
        <Body id={current.id} trade={trade} read={read} />
      </Panel>
    </>
  );
}
