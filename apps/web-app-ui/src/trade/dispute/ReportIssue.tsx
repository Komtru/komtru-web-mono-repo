'use client';

// Customer-7 and CWT-S14 — "Report an Issue", the whole-trade intake.
//
// The two reference screens are the same screen: C7 is drawn from the buyer's confirm-delivery
// step and CWT-S14 from the workspace, and they differ only in that CWT-S14 shows the trade's
// three term rows above the question. Both are built here, with the rows drawn from the trade the
// platform actually answered — never asserted.
//
// The reference marks a reason pre-selected. Nothing is pre-selected here: a dispute category is
// recorded on a financial case, and a buyer who tapped through quickly should not find they have
// filed under a reason they never chose. The button stays disabled until they pick one.
import { useState } from 'react';
import type { TradeView } from '@komtru/api-client';
import { useOpenDispute } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, TermList, TermRow, TextArea } from '@komtru/ui-kit';
import { Frame, TradeGate } from '../delivery/parts';
import { naira, problemMessage } from '../format';
import { ReasonChoice } from './parts';
import { issueReviewHref, tradeHref } from './routes';
import { ISSUE_REASONS, protectedLead, type IssueReason } from './words';

const TITLE = 'Report an Issue';

export function ReportIssue({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title={TITLE}
      role="BUYER"
      deniedWhy="Only the buyer can report an issue with what arrived. If you need help with this trade, open a support ticket."
    >
      {(trade) => <Form id={id} trade={trade} />}
    </TradeGate>
  );
}

function Form({ id, trade }: { id: string; trade: TradeView }): React.JSX.Element {
  const amount = trade.terms?.itemAmountMinor ?? null;
  const [reason, setReason] = useState<IssueReason | null>(null);
  const [account, setAccount] = useState('');
  const open = useOpenDispute();

  const submit = (): void => {
    if (reason === null || open.isPending) return;
    open.mutate(
      { tradeId: id, category: reason.category, reason: account.trim() || reason.label },
      {
        onSuccess: () => {
          // DI-01 is the reference's next step: the structured review, then evidence.
          window.location.assign(issueReviewHref(id));
        },
      },
    );
  };

  return (
    <Frame title={TITLE} id={id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">
        {/* The amount is the trade's own agreed figure. A trade with no accepted terms has none,
            and the line says the true thing without one rather than printing a zero. */}
        {amount === null
          ? 'Your payment stays protected while this is reviewed — nothing releases until it is resolved.'
          : protectedLead(amount)}
      </p>

      {/* CWT-S14's three rows. Every value is the platform's own answer for this trade. */}
      <TermList aria-label="This trade">
        <TermRow label="Trade">{trade.tradeCode}</TermRow>
        {amount !== null && <TermRow label="Amount">{naira(amount)}</TermRow>}
        <TermRow label="Funds">Protected</TermRow>
      </TermList>

      <ReasonChoice
        legend="What went wrong?"
        name="issue-reason"
        options={ISSUE_REASONS.map((option) => ({ id: option.id, label: option.label }))}
        value={reason?.id ?? null}
        onChange={(chosen) => {
          setReason(ISSUE_REASONS.find((option) => option.id === chosen) ?? null);
        }}
      />

      <TextArea
        label="Tell us what happened"
        rows={4}
        placeholder="Describe the issue"
        value={account}
        onChange={(event) => {
          setAccount(event.target.value);
        }}
        maxLength={2000}
      />

      <NoteBanner>
        Komtru reviews the issue against the agreed terms and the evidence submitted. A refund or return is
        not guaranteed by submitting a report.
      </NoteBanner>

      {open.isError && (
        <p role="alert" className="mt-[12px] text-[12px] text-risk-on-soft">
          {problemMessage(open.error, 'We couldn’t open the case. Try again.')}
        </p>
      )}

      <ActionStack>
        <Button onClick={submit} disabled={reason === null || open.isPending}>
          {open.isPending ? 'Opening the case…' : 'Continue to issue review'}
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
