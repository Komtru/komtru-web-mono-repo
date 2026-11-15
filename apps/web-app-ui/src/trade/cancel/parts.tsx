'use client';

import { ActionStack, Button, NoteBanner, OptionCard, StatusHero } from '@komtru/ui-kit';
import { tradeHref } from '../delivery/parts';
import { reasonLabel, type CancellationReasonCode } from './words';

/** One reason, chosen from the platform's own list: a radio group, never free text, so the code sent is a real one. */
export function ReasonChoice<T extends CancellationReasonCode>({
  legend,
  name,
  reasons,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  reasons: readonly T[];
  value: T | undefined;
  onChange: (reason: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className="mb-[14px] border-0 p-0">
      <legend className="mb-[8px] text-[12px] font-semibold">{legend}</legend>
      {reasons.map((reason) => (
        <OptionCard
          key={reason}
          name={name}
          value={reason}
          checked={value === reason}
          onChange={() => {
            onChange(reason);
          }}
        >
          {reasonLabel(reason)}
        </OptionCard>
      ))}
    </fieldset>
  );
}

/** A screen with nothing to offer here: what the platform says, a way back to the trade, and no control. */
export function Notice({
  id,
  title,
  children,
  tone = 'info',
}: {
  id: string;
  title?: string;
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning';
}): React.JSX.Element {
  return (
    <>
      {title === undefined ? (
        <NoteBanner>{children}</NoteBanner>
      ) : (
        <StatusHero tone={tone} as="h2" title={title}>
          {children}
        </StatusHero>
      )}
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Open the trade</a>
        </Button>
      </ActionStack>
    </>
  );
}
