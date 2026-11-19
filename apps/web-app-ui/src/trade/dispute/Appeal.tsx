'use client';

// AC6 — "File an Appeal". Behind the "File an appeal" buttons on H1 and the case status screen.
//
// The banner states the rule the platform actually enforces: one per case, a different reviewer,
// and no reopening of evidence already submitted. The screen is drawn only when the platform says
// an appeal is still available, so it never offers a door that is already shut.
import { useState } from 'react';
import type { DisputeDetail } from '@komtru/api-client';
import { useAppealDispute } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, TextArea } from '@komtru/ui-kit';
import { Frame, Refusal, TradeGate } from '../delivery/parts';
import { problemMessage } from '../format';
import { DisputeGate } from './parts';
import { disputeStatusHref } from './routes';
import { APPEAL_NOTE, canAppeal } from './words';

const TITLE = 'File an Appeal';

export function Appeal({ id, disputeId }: { id: string; disputeId?: string }): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {() => (
        <DisputeGate id={id} disputeId={disputeId} title={TITLE}>
          {(dispute) =>
            canAppeal(dispute) ? (
              <Form id={id} dispute={dispute} />
            ) : (
              <Refusal
                id={id}
                title={TITLE}
                why={
                  dispute.appealFiledAt !== null
                    ? 'This case has already been appealed. One appeal per case — the lead reviewing it has the final say.'
                    : 'There is no decision to appeal yet. An appeal opens once the case has been decided.'
                }
              />
            )
          }
        </DisputeGate>
      )}
    </TradeGate>
  );
}

function Form({ id, dispute }: { id: string; dispute: DisputeDetail }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const appeal = useAppealDispute();
  const ready = reason.trim().length > 0;

  return (
    <Frame title={TITLE} id={id}>
      <NoteBanner>{APPEAL_NOTE}</NoteBanner>

      <TextArea
        label="What specifically do you disagree with?"
        rows={5}
        placeholder="Explain what you think was missed or misjudged"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
        maxLength={2000}
        helper="Only what wasn’t already part of the original case."
      />

      {appeal.isError && (
        <p role="alert" className="mt-[4px] text-[12px] text-risk-on-soft">
          {problemMessage(appeal.error, 'We couldn’t file the appeal. Try again.')}
        </p>
      )}

      <ActionStack>
        <Button
          disabled={!ready || appeal.isPending}
          onClick={() => {
            if (!ready || appeal.isPending) return;
            appeal.mutate(
              { disputeId: dispute.id, reason: reason.trim() },
              {
                onSuccess: () => {
                  window.location.assign(disputeStatusHref(id));
                },
              },
            );
          }}
        >
          {appeal.isPending ? 'Submitting…' : 'Submit appeal'}
        </Button>
        <Button asChild variant="secondary">
          <a href={disputeStatusHref(id)}>Back to the case</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
