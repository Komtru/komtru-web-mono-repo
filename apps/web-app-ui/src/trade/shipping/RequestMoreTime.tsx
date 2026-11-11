'use client';

import type { DeliveryExtensionReason } from '@komtru/api-client';
import { useDeliveryDeadline, useRequestDeliveryExtension, useTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  StatusHero,
  TextField,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { EXTENSION_REASONS, deliveryTimeState } from '../delivery-time';
import { isProblem, platformWords, problemMessage, whenLabel } from '../format';
import { ItemSummary } from '../parts';
import { useNow } from '../use-now';

const tradeHref = (id: string) => `/trade/${id}`;

function Frame({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="Request more time" backHref={tradeHref(id)} backLabel="Back to the trade" />
      {children}
    </ScreenColumn>
  );
}

const Back = ({ id }: { id: string }): React.JSX.Element => (
  <ActionStack>
    <Button asChild variant="secondary">
      <a href={tradeHref(id)}>Back to the trade</a>
    </Button>
  </ActionStack>
);

/** A `datetime-local` value, in the person's own time, as the instant the platform takes. */
export const toInstant = (local: string): string | undefined => {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/**
 * F-027 (DE1): the seller asks the buyer for a later delivery date, before the deadline passes. Once per
 * deadline, to a later date no more than one original window beyond it: those limits are the platform's, and its
 * refusal is shown in its own words. This screen only offers the ask while the platform's reads say it may be made.
 */
export function RequestMoreTime({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);
  const deadline = useDeliveryDeadline(id, trade.data !== undefined);
  const ask = useRequestDeliveryExtension();
  const now = useNow();
  const [reason, setReason] = useState<DeliveryExtensionReason | undefined>(undefined);
  const [date, setDate] = useState('');
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  if (trade.isPending || (trade.data !== undefined && deadline.isPending)) {
    return (
      <Frame id={id}>
        <LoadingScreen label="Loading the delivery date" />
      </Frame>
    );
  }
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn’t open this trade"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  if (deadline.isError) {
    return (
      <Frame id={id}>
        <RiskBanner>
          {problemMessage(deadline.error, 'We couldn’t load the delivery date. Try again.')}
        </RiskBanner>
        <ActionStack>
          <Button type="button" variant="secondary" onClick={() => void deadline.refetch()}>
            Try again
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  if (deadline.data === undefined) {
    return (
      <Frame id={id}>
        <LoadingScreen label="Loading the delivery date" />
      </Frame>
    );
  }
  const view = trade.data;
  const state = deliveryTimeState(deadline.data, view.yourRole, now);
  const due = deadline.data.deadline?.dueAt;

  if (sent) {
    return (
      <Frame id={id}>
        <StatusHero tone="success" as="h2" title="Request sent">
          The buyer has been asked. The delivery date stays as it is until they answer.
        </StatusHero>
        <Back id={id} />
      </Frame>
    );
  }
  if (view.yourRole !== 'SELLER' || (view.status !== 'FUNDED' && view.status !== 'SHIPPED')) {
    return (
      <Frame id={id}>
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          Only the seller can ask for more time to deliver, and only while the item is paid for and not yet
          delivered.
        </p>
        <Back id={id} />
      </Frame>
    );
  }
  if (state.kind !== 'can-ask') {
    const words =
      state.kind === 'overdue'
        ? 'The delivery date has passed, so it can’t be moved now.'
        : state.kind === 'request-pending'
          ? 'You’ve already asked. The buyer hasn’t answered yet.'
          : 'More time was already asked for on this deadline. It can only be asked for once.';
    return (
      <Frame id={id}>
        <NoteBanner>{words}</NoteBanner>
        <Back id={id} />
      </Frame>
    );
  }

  const requested = date === '' ? undefined : toInstant(date);
  const later =
    requested !== undefined && due !== undefined && new Date(requested).getTime() > new Date(due).getTime();
  const dateError =
    touched && !later
      ? due === undefined
        ? 'Choose a delivery date.'
        : `Choose a date later than ${whenLabel(due)}.`
      : undefined;
  const ready = reason !== undefined && later;

  const send = () => {
    if (!ready || requested === undefined) return;
    setProblem(undefined);
    ask.mutate(
      { id, reason, requestedDueAt: requested, ...(note.trim() === '' ? {} : { note: note.trim() }) },
      {
        onSuccess: () => {
          setSent(true);
        },
        onError: (error) => {
          setProblem(platformWords(error, 'We couldn’t send the request. Try again.'));
        },
      },
    );
  };

  return (
    <Frame id={id}>
      {due !== undefined && (
        <WarnBanner title="Delivery is due">{`Due ${whenLabel(due)}. You can ask for more time before it passes.`}</WarnBanner>
      )}
      <ItemSummary trade={view} />
      <fieldset className="mb-[14px] border-0 p-0">
        <legend className="mb-[8px] text-[12px] font-semibold">Why do you need more time?</legend>
        {EXTENSION_REASONS.map((item) => (
          <label key={item.value} className="mb-[8px] flex items-center gap-[10px] text-[12.5px]">
            <input
              type="radio"
              name="reason"
              className="h-[16px] w-[16px] accent-trust-indigo"
              checked={reason === item.value}
              onChange={() => {
                setReason(item.value);
              }}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <SectionLabel>New delivery date</SectionLabel>
      <TextField
        label="New delivery date and time"
        type="datetime-local"
        value={date}
        invalid={dateError !== undefined}
        {...(dateError === undefined ? {} : { helper: dateError })}
        onChange={(event) => {
          setDate(event.target.value);
        }}
        onBlur={() => {
          setTouched(true);
        }}
      />
      <TextField
        label="Note to buyer (optional)"
        value={note}
        maxLength={500}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" onClick={send} disabled={!ready || ask.isPending}>
          {ask.isPending ? 'Sending…' : 'Send extension request'}
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
