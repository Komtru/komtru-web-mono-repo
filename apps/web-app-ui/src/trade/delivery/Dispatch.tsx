'use client';

import type { TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  ReadyBanner,
  SectionLabel,
  TermList,
  TermRow,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { hoursLabel, partyName } from '../format';
import { tabHref, trackHref, waybillHref } from '../workspace-state';
import { Frame, Refusal, TradeGate, tradeHref } from './parts';
import { ReportDelivery } from './ReportDelivery';

const TITLE = 'Ready to Dispatch';

/** Before the escrow is funded the guard holds; the platform enforces the same rule on the server. */
const BEFORE_FUNDING = [
  'DRAFT',
  'PENDING_COUNTERPARTY',
  'UNDER_PROPOSAL_REVIEW',
  'AWAITING_ACCEPTANCE',
  'PENDING_PAYMENT',
];
const SHIPPED_ONWARD = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED', 'DISPUTED'];

/**
 * CWT-S08 (X1): the seller's last look before handing the item over. The guard is the trade's status, drawn:
 * locked until the payment is protected, ready while it is `FUNDED`, and past it once the item has shipped.
 * Delivery is the seller's own arrangement (Park and couriers are not in the MVP), so there is no waybill to
 * generate: the next step is giving the waybill details.
 */
export function Dispatch({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title={TITLE}
      role="SELLER"
      deniedWhy="Only the seller dispatches a trade. You can follow its delivery from the trade."
    >
      {(trade) => <ByStatus trade={trade} />}
    </TradeGate>
  );
}

function ByStatus({ trade }: { trade: TradeView }): React.JSX.Element {
  if (BEFORE_FUNDING.includes(trade.status)) return <Locked trade={trade} />;
  if (SHIPPED_ONWARD.includes(trade.status)) {
    return (
      <Frame title={TITLE} id={trade.id}>
        <p role="status" className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          This item has already been handed over.
        </p>
        <ReportDelivery trade={trade} />
        <ActionStack>
          <Button asChild>
            <a href={trackHref(trade.id)}>Track the delivery</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={tradeHref(trade.id)}>Back to the trade</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  if (trade.status !== 'FUNDED') {
    return <Refusal id={trade.id} title={TITLE} why="This trade isn’t waiting to be dispatched." />;
  }
  return <Ready trade={trade} />;
}

function Locked({ trade }: { trade: TradeView }): React.JSX.Element {
  const buyer =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'The buyer'
      : partyName(trade.counterparty);
  const awaitingPayment = trade.status === 'PENDING_PAYMENT';
  return (
    <Frame title={TITLE} id={trade.id}>
      <WarnBanner title={awaitingPayment ? 'Dispatch locked · Awaiting payment' : 'Dispatch locked'}>
        {awaitingPayment
          ? `${buyer} hasn’t paid yet. Do not dispatch until the payment is protected.`
          : 'This trade isn’t agreed and paid for yet. Dispatch opens once the payment is protected.'}
      </WarnBanner>
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        If payment is not protected, dispatch stays locked. This guard is enforced server-side.
      </p>
      <ActionStack>
        <Button type="button" disabled>
          Dispatch locked
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

const CHECKLIST = ['Package sealed and labelled', 'Waybill or courier receipt ready'] as const;

function Ready({ trade }: { trade: TradeView }): React.JSX.Element {
  // The checklist is the seller's own reminder before handing over: the platform's real gates (payment protected,
  // the waybill evidence) are enforced on the next screen and on the server, so ticking does not unlock anything.
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const hours = trade.terms?.inspectionWindowHours;
  return (
    <Frame title={TITLE} id={trade.id}>
      <ReadyBanner title="Payment is protected">
        Confirm the delivery route before handing the item over.
      </ReadyBanner>
      <SectionLabel>Dispatch terms</SectionLabel>
      <TermList aria-label="Dispatch terms">
        <TermRow label="Payment">Protected</TermRow>
        <TermRow label="Delivery">Arranged by you</TermRow>
        {hours !== undefined && <TermRow label="Inspection">{hoursLabel(hours)} minimum</TermRow>}
      </TermList>
      <fieldset className="mb-[14px] min-w-0 border-0 p-0">
        <legend className="mb-[8px] p-0">
          <SectionLabel>Handover checklist</SectionLabel>
        </legend>
        {CHECKLIST.map((item) => (
          <label
            key={item}
            className="mb-[8px] flex cursor-pointer items-start gap-[10px] rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-primary p-[12px] text-[12.5px] font-semibold has-[:checked]:border-trust-indigo has-[:checked]:bg-trust-indigo-soft"
          >
            <input
              type="checkbox"
              className="mt-[1px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
              checked={ticked.includes(item)}
              onChange={(event) => {
                setTicked((current) =>
                  event.target.checked ? [...current, item] : current.filter((entry) => entry !== item),
                );
              }}
            />
            <span>{item}</span>
          </label>
        ))}
        <label className="mb-[8px] flex items-start gap-[10px] rounded-md border-[1.5px] border-solid border-trust-indigo bg-trust-indigo-soft p-[12px] text-[12.5px] font-semibold">
          <input
            type="checkbox"
            className="mt-[1px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
            checked
            disabled
            readOnly
          />
          <span>Dispatch allowed</span>
        </label>
      </fieldset>
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        If payment is not protected, dispatch stays locked. This guard is enforced server-side.
      </p>
      <ActionStack>
        <Button asChild>
          <a href={waybillHref(trade.id)}>Add waybill details</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={tabHref(trade.id, 'terms')}>View agreement</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
