'use client';

// What the dispute screens share beyond the delivery sheets' own chrome: the gate that reads the
// case, the reason picker, and the step rail Customer-8 / CWT-S15 / SP-M23 all draw.
//
// `Frame`, `Refusal` and `ReadFailed` come from the delivery sheets (F-028) rather than being
// copied: they already answer loading, offline, error, not-found and permission-denied in the
// words this app uses, and a second copy would drift.
import type { Dispute, DisputeDetail } from '@komtru/api-client';
import { useDispute } from '@komtru/api-client/react';
import { CountdownStrip, LoadingScreen, OptionCard, SectionLabel, type VersionStep } from '@komtru/ui-kit';
import { Frame, ReadFailed, Refusal } from '../delivery/parts';
import { isProblem } from '../format';
import { countdownLine } from './words';

/**
 * Reads the case and hands it to `children`, with every state the screen can be in answered.
 *
 * A dispute the caller is not a party to answers 404 from the platform, deliberately — a dispute
 * id must not be an oracle for "these two are in a fight" — so "not found" and "not yours" are
 * one branch here too, and say the same thing.
 */
export function DisputeGate({
  id,
  disputeId,
  title,
  children,
}: {
  id: string;
  disputeId: string | undefined;
  title: string;
  children: (dispute: DisputeDetail) => React.ReactNode;
}): React.JSX.Element {
  const dispute = useDispute(disputeId ?? '', disputeId !== undefined);

  if (disputeId === undefined) {
    return <Refusal id={id} title={title} why="There is no issue open on this trade." />;
  }
  if (dispute.isPending) {
    return (
      <Frame title={title} id={id}>
        <LoadingScreen label="Loading the case" />
      </Frame>
    );
  }
  if (dispute.isError && isProblem(dispute.error, 'NOT_FOUND')) {
    return <Refusal id={id} title={title} why="There is no issue open on this trade." />;
  }
  if (dispute.isError) {
    return (
      <Frame title={title} id={id}>
        <ReadFailed error={dispute.error} noun="this case" onRetry={() => void dispute.refetch()} />
      </Frame>
    );
  }
  return <>{children(dispute.data)}</>;
}

/**
 * A radio group of the reference's `.reason-option` rows. A real fieldset with a real radio under
 * each, so the code sent is always one the platform knows and the group is one tab stop.
 */
export function ReasonChoice<T extends string>({
  legend,
  options,
  value,
  onChange,
  name,
}: {
  legend: string;
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
  name: string;
}): React.JSX.Element {
  return (
    <fieldset className="mb-[18px] border-0 p-0">
      {/* The label IS the legend, so the group has one accessible name and no duplicate heading. */}
      <legend className="contents">
        <SectionLabel as="p">{legend}</SectionLabel>
      </legend>
      <div className="flex flex-col gap-[8px]">
        {options.map((option) => (
          <OptionCard
            key={option.id}
            name={name}
            value={option.id}
            checked={value === option.id}
            onChange={(event) => {
              onChange(event.target.value as T);
            }}
          >
            {option.label}
          </OptionCard>
        ))}
      </div>
    </fieldset>
  );
}

/** The clock the platform says is running, or nothing. Never a countdown the screen invented. */
export function DisputeCountdown({ dispute }: { dispute: Dispute }): React.JSX.Element | null {
  const line = countdownLine(dispute);
  return line === null ? null : <CountdownStrip>{line}</CountdownStrip>;
}

/**
 * Customer-8's and CWT-S15's step rail, built from the case's real status rather than a fixed
 * four-step script: a case that was withdrawn in mediation never had a TrustOps step, and drawing
 * one greyed out would promise a review that is not coming.
 */
export function caseSteps(dispute: Dispute, counterpartyName: string): VersionStep[] {
  const reached = (statuses: readonly Dispute['status'][]): boolean => statuses.includes(dispute.status);
  const past = (statuses: readonly Dispute['status'][]): boolean =>
    !reached(statuses) && ORDER.indexOf(dispute.status) > Math.min(...statuses.map((s) => ORDER.indexOf(s)));

  const state = (statuses: readonly Dispute['status'][]): VersionStep['state'] =>
    past(statuses) ? 'done' : reached(statuses) ? 'active' : 'pending';

  const steps: VersionStep[] = [
    { id: 'filed', title: 'You reported this issue', detail: 'Filed', state: 'done' },
    { id: 'notified', title: `${counterpartyName} was notified`, detail: 'Filed', state: 'done' },
    {
      id: 'response',
      title: 'Awaiting the other side’s response',
      detail: dispute.window.kind === 'MEDIATION' ? pending(dispute) : 'Done',
      state: state(['MEDIATION']),
    },
  ];

  // A case withdrawn in mediation never had a review, so it gets no greyed-out review step: a
  // pending node is a promise that something is still coming.
  if (dispute.status !== 'CLOSED' || dispute.decidedAt !== null) {
    steps.push({
      id: 'evidence',
      title: 'Evidence',
      detail: dispute.window.kind === 'EVIDENCE' ? pending(dispute) : 'Both sides',
      state: state(['OPEN_EVIDENCE_COLLECTION']),
    });
    steps.push({
      id: 'decision',
      title: 'TrustOps decision',
      detail: dispute.decidedAt === null ? 'Not started' : 'Decided',
      state: dispute.decidedAt === null ? state(['UNDER_REVIEW']) : 'done',
    });
  }
  return steps;
}

const ORDER: readonly Dispute['status'][] = [
  'MEDIATION',
  'OPEN_EVIDENCE_COLLECTION',
  'UNDER_REVIEW',
  'DECIDED',
  'APPEALED',
  'APPEAL_UNDER_REVIEW',
  'CLOSED',
];

const pending = (dispute: Dispute): string => {
  const left = dispute.window.remaining;
  if (left === null || left.expired) return 'Any moment now';
  return left.hours > 0 ? `${String(left.hours)}h left to reply` : `${String(left.minutes)}m left to reply`;
};
