'use client';

// Z5 (confirm and release) and BEI1 (ask for more inspection time): the two decisions on Inspect & Confirm that
// rise from the bottom of the screen, as the reference draws every confirmation.
import { tradeKeys, useAcceptInspection, useRequestInspectionExtension } from '@komtru/api-client/react';
import { Button, RiskBanner, Sheet, TextField } from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { hoursLabel, platformWords } from '../format';
import { OverTabBar } from '../parts';

/** The sentence the platform stores with the acknowledgement; the checkbox says exactly this. */
export const ACKNOWLEDGEMENT =
  'I’ve compared the item to the seller’s proof and confirm it matches what was agreed.';

/** Z5: the irreversible step, behind an explicit acknowledgement. Nothing is sent until the box is ticked. */
export function ReleaseSheet({
  open,
  tradeId,
  amount,
  seller,
  onClose,
}: {
  open: boolean;
  tradeId: string;
  /** The item amount, formatted: what Komtru releases from escrow. */
  amount: string | undefined;
  seller: string;
  onClose: () => void;
}): React.JSX.Element {
  const accept = useAcceptInspection();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const close = () => {
    setTicked(false);
    setProblem(undefined);
    onClose();
  };
  const confirm = () => {
    if (!ticked) return;
    setProblem(undefined);
    accept.mutate(tradeId, {
      // The trade is now completed; the screen re-renders as the finished trade, so there is nothing to close.
      onSuccess: () => {
        setTicked(false);
      },
      onError: (error) => {
        void queryClient.invalidateQueries({ queryKey: tradeKeys.one(tradeId), exact: true });
        void queryClient.invalidateQueries({ queryKey: tradeKeys.inspection(tradeId) });
        setProblem(platformWords(error, 'We couldn’t release the payment. Nothing was sent. Try again.'));
      },
    });
  };
  return (
    <OverTabBar>
      <Sheet
        open={open}
        onClose={close}
        title={amount === undefined ? `Release the payment to ${seller}?` : `Release ${amount} to ${seller}?`}
        footer={
          <>
            <Button type="button" disabled={!ticked || accept.isPending} onClick={confirm}>
              {accept.isPending ? 'Releasing…' : 'Confirm & Release'}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </>
        }
      >
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          This can’t be undone once confirmed. The payment is released to the seller.
        </p>
        <label className="mb-[14px] flex items-start gap-[10px] text-[12.5px] leading-[1.5]">
          <input
            type="checkbox"
            className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
            checked={ticked}
            onChange={(event) => {
              setTicked(event.target.checked);
            }}
          />
          <span>{ACKNOWLEDGEMENT}</span>
        </label>
        {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      </Sheet>
    </OverTabBar>
  );
}

/** The longest ask the platform will take is one original window; the choices never offer more than that. */
export function extraHourChoices(windowHours: number): number[] {
  return [...new Set([12, 24, windowHours])]
    .filter((hours) => hours >= 1 && hours <= windowHours)
    .sort((a, b) => a - b);
}

/** BEI1: more inspection time, once; the seller has to agree. Options are hours, never a typed number. */
export function MoreTimeSheet({
  open,
  tradeId,
  windowHours,
  onClose,
}: {
  open: boolean;
  tradeId: string;
  windowHours: number;
  onClose: () => void;
}): React.JSX.Element {
  const ask = useRequestInspectionExtension();
  const choices = extraHourChoices(windowHours);
  const [hours, setHours] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const close = () => {
    setProblem(undefined);
    onClose();
  };
  const send = () => {
    if (hours === undefined) return;
    setProblem(undefined);
    ask.mutate(
      { id: tradeId, extraHours: hours, ...(note.trim() === '' ? {} : { note: note.trim() }) },
      {
        onSuccess: close,
        onError: (error) => {
          setProblem(platformWords(error, 'We couldn’t send the request. Try again.'));
        },
      },
    );
  };
  return (
    <OverTabBar>
      <Sheet
        open={open}
        onClose={close}
        title="Ask for more time"
        footer={
          <>
            <Button type="button" disabled={hours === undefined || ask.isPending} onClick={send}>
              {ask.isPending ? 'Sending…' : 'Send request'}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </>
        }
      >
        <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
          The standard window is {hoursLabel(windowHours)}. You can ask once, and the seller has to agree,
          since it holds their funds longer too. Your funds stay protected either way.
        </p>
        <fieldset className="mb-[14px] border-0 p-0">
          <legend className="mb-[8px] text-[12px] font-semibold">How much more time?</legend>
          {choices.map((choice) => (
            <label key={choice} className="mb-[8px] flex items-center gap-[10px] text-[12.5px]">
              <input
                type="radio"
                name="extra-hours"
                className="h-[16px] w-[16px] accent-trust-indigo"
                checked={hours === choice}
                onChange={() => {
                  setHours(choice);
                }}
              />
              {`${hoursLabel(choice)} more`}
            </label>
          ))}
        </fieldset>
        <TextField
          label="Why do you need more time? (optional)"
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      </Sheet>
    </OverTabBar>
  );
}
