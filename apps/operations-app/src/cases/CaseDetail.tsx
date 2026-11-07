'use client';

// The universal case page (AC10): the case on the left, the decision on the right.
//
// The decision is a person's. The advisory arrives from `GET /cases/:id/advisory`, is drawn as prose
// in `DecisionPanel`'s advisory box, and is read by nothing else on this page: it never fills the
// form, never enables a button and is never sent. `Record decision` stays disabled until a person
// has typed an outcome, a reason and the policy clause themselves.
import {
  CASE_PRIORITIES,
  decideCase,
  escalateCase,
  reassignCase,
  requestCaseEvidence,
  resolveCaseEvidence,
  setCasePriority,
  takeCase,
  type CaseDetail as CaseDetailData,
  type CaseTrailEntry,
  type EvidenceRequest,
} from '@komtru/api-client';
import {
  AdvisoryBox,
  Banner,
  Button,
  CaseLayout,
  Chip,
  DecisionPanel,
  EmptyState,
  Field,
  Select,
  Skeleton,
  TextField,
  TrustTrail,
  CONTROL_CLASS,
  type TimelineEvent,
} from '@komtru/ui-kit';
import { useId, useState } from 'react';
import {
  clockLabel,
  clockTone,
  humanise,
  ownerLabel,
  priorityLabel,
  stateLabel,
  trailLabel,
  typeLabel,
  whenLabel,
  factLabel,
} from './format';
import { useCaseAction, useCaseAdvisory, useCaseDetail, useCaseTrail } from './hooks';
import { QueueFrame, useCanManage, useViewerId } from './shared';

const PANEL = 'mb-[16px] rounded-lg border border-solid border-border-hairline bg-surface-elevated p-[20px]';
const SMALL = 'w-auto!';

function Panel({ heading, children }: { heading: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-label={heading} className={PANEL}>
      <h2 className="mb-[12px] text-[14px] font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

function TextArea({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}): React.JSX.Element {
  const fieldId = useId();
  return (
    <Field id={fieldId} label={label} helperId={`${fieldId}-helper`}>
      <textarea
        id={fieldId}
        value={value}
        maxLength={maxLength}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_CLASS}
      />
    </Field>
  );
}

const present = (value: string): boolean => value.trim() !== '';

function factValue(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function Facts({ facts }: { facts: CaseDetailData['facts'] }): React.JSX.Element {
  const entries = Object.entries(facts);
  return (
    <Panel heading="What we know">
      {entries.length === 0 ? (
        <p className="text-[12px] text-slate">The owning team has not recorded any facts on this case.</p>
      ) : (
        <dl className="m-0">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex justify-between gap-[10px] border-b border-solid border-border-hairline py-[9px] text-[12.5px] last:border-b-0"
            >
              <dt className="m-0 font-semibold">{factLabel(key)}</dt>
              <dd className="m-0 text-right text-slate">{factValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function EvidenceRequests({
  caseId,
  requests,
  canAct,
}: {
  caseId: string;
  requests: EvidenceRequest[];
  canAct: boolean;
}): React.JSX.Element {
  const resolve = useCaseAction((client, vars: { requestId: string; status: 'FULFILLED' | 'CANCELLED' }) =>
    client.call(resolveCaseEvidence, {
      params: { id: caseId, requestId: vars.requestId },
      body: { status: vars.status },
    }),
  );
  return (
    <Panel heading="Evidence asked for">
      {requests.length === 0 ? (
        <p className="text-[12px] text-slate">No evidence has been asked for on this case.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-[10px] border-b border-solid border-border-hairline py-[10px] text-[12.5px] last:border-b-0"
            >
              <span>
                <b className="block">{request.description}</b>
                <span className="text-[11px] text-slate">
                  {request.status === 'OPEN' ? 'Waiting' : humanise(request.status)}
                  {request.dueAt === null ? '' : ` · due ${whenLabel(request.dueAt)}`}
                  {request.resolutionNote === null ? '' : ` · ${request.resolutionNote}`}
                </span>
              </span>
              {canAct && request.status === 'OPEN' && (
                <span className="flex gap-[8px]">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ requestId: request.id, status: 'FULFILLED' })}
                    className={SMALL}
                  >
                    Mark fulfilled
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ requestId: request.id, status: 'CANCELLED' })}
                  >
                    Cancel request
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {resolve.isError && (
        <Banner tone="risk" className="mt-[10px]">
          We could not update that request. It may already have been resolved.
        </Banner>
      )}
    </Panel>
  );
}

function trailEvents(entries: CaseTrailEntry[], viewerId: string | undefined): TimelineEvent[] {
  return entries.map((entry) => ({
    id: String(entry.id),
    title: trailLabel(entry.type),
    detail: [
      entry.reason,
      entry.actorUserId === null ? 'System' : ownerLabel(entry.actorUserId, viewerId),
      whenLabel(entry.occurredAt),
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
  }));
}

function Trail({ caseId }: { caseId: string }): React.JSX.Element {
  const viewerId = useViewerId();
  const trail = useCaseTrail(caseId);
  if (trail.isError) {
    return (
      <Panel heading="Trust Trail">
        <p className="text-[12px] text-slate">The Trust Trail did not load. Reload the page to try again.</p>
      </Panel>
    );
  }
  return (
    <TrustTrail
      events={trail.data === undefined ? [] : trailEvents(trail.data.items, viewerId)}
      empty={trail.isPending ? 'Loading the Trust Trail…' : undefined}
    />
  );
}

function ErrorLine({ failed, what }: { failed: boolean; what: string }): React.JSX.Element | null {
  return failed ? (
    <Banner tone="risk" className="mt-[10px]">
      We could not {what}. The case was not changed; try again.
    </Banner>
  ) : null;
}

/** Escalate, change priority, request evidence: the owner's other moves besides deciding. */
function WorkThisCase({ data }: { data: CaseDetailData }): React.JSX.Element {
  const [escalateReason, setEscalateReason] = useState('');
  const [priority, setPriority] = useState(data.priority);
  const [priorityReason, setPriorityReason] = useState('');
  const [description, setDescription] = useState('');

  const escalate = useCaseAction((client, reason: string) =>
    client.call(escalateCase, { params: { id: data.id }, body: { reason } }),
  );
  const changePriority = useCaseAction((client, vars: { priority: typeof priority; reason: string }) =>
    client.call(setCasePriority, { params: { id: data.id }, body: vars }),
  );
  const askEvidence = useCaseAction((client, text: string) =>
    client.call(requestCaseEvidence, { params: { id: data.id }, body: { description: text } }),
  );

  return (
    <Panel heading="Work this case">
      {data.state !== 'ESCALATED' && (
        <div className="mb-[16px] grid gap-[8px]">
          <TextField
            label="Reason for escalating"
            value={escalateReason}
            maxLength={1000}
            onChange={(event) => setEscalateReason(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!present(escalateReason) || escalate.isPending}
            onClick={() => escalate.mutate(escalateReason.trim(), { onSuccess: () => setEscalateReason('') })}
            className={SMALL}
          >
            Escalate
          </Button>
          <ErrorLine failed={escalate.isError} what="escalate this case" />
        </div>
      )}

      <div className="mb-[16px] grid gap-[8px]">
        <Select
          label="New priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
          options={CASE_PRIORITIES.map((value) => ({ value, label: priorityLabel(value) }))}
        />
        <TextField
          label="Reason for the change"
          value={priorityReason}
          maxLength={1000}
          onChange={(event) => setPriorityReason(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!present(priorityReason) || priority === data.priority || changePriority.isPending}
          onClick={() =>
            changePriority.mutate(
              { priority, reason: priorityReason.trim() },
              { onSuccess: () => setPriorityReason('') },
            )
          }
          className={SMALL}
        >
          Change priority
        </Button>
        <ErrorLine failed={changePriority.isError} what="change the priority" />
      </div>

      <div className="grid gap-[8px]">
        <TextField
          label="What do you need?"
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!present(description) || askEvidence.isPending}
          onClick={() => askEvidence.mutate(description.trim(), { onSuccess: () => setDescription('') })}
          className={SMALL}
        >
          Request evidence
        </Button>
        <ErrorLine failed={askEvidence.isError} what="request that evidence" />
      </div>
    </Panel>
  );
}

function DecisionForm({
  data,
  advisory,
}: {
  data: CaseDetailData;
  advisory: { suggestion: string; rationale: string[]; label: string } | undefined;
}): React.JSX.Element {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState('');
  const [clause, setClause] = useState('');
  const decide = useCaseAction((client, body: { outcome: string; reason: string; policyCitation: string }) =>
    client.call(decideCase, { params: { id: data.id }, body }),
  );

  const complete = present(outcome) && present(reason) && present(policy) && present(clause);
  const clauseText = clause.trim().replace(/^§\s*/, '');
  const prose = advisory === undefined ? undefined : [advisory.suggestion, ...advisory.rationale];

  return (
    <DecisionPanel
      heading="Your decision"
      {...(prose === undefined ? {} : { advisory: prose, advisoryLabel: advisory?.label ?? '' })}
      policy={{
        policy: present(policy) ? policy.trim() : 'the policy named below',
        section: clauseText || '…',
      }}
      footnote="Your reason and the policy are saved to the Trust Trail. Both parties are told."
      actions={
        <>
          <TextField
            label="Outcome"
            value={outcome}
            maxLength={80}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <TextArea label="Reason" value={reason} maxLength={2000} onChange={setReason} />
          <TextField
            label="Policy"
            value={policy}
            maxLength={150}
            onChange={(e) => setPolicy(e.target.value)}
          />
          <TextField
            label="Clause"
            value={clause}
            maxLength={40}
            onChange={(e) => setClause(e.target.value)}
          />
          <Button
            type="button"
            disabled={!complete || decide.isPending}
            onClick={() =>
              decide.mutate({
                outcome: outcome.trim(),
                reason: reason.trim(),
                policyCitation: `${policy.trim()} §${clauseText}`,
              })
            }
          >
            Record decision
          </Button>
          <ErrorLine failed={decide.isError} what="record the decision" />
        </>
      }
    />
  );
}

function Decision({
  data,
  canManage,
  viewerId,
}: {
  data: CaseDetailData;
  canManage: boolean;
  viewerId: string | undefined;
}): React.JSX.Element {
  const advisoryQuery = useCaseAdvisory(data.id);
  const advisory = advisoryQuery.data;
  const [reassignReason, setReassignReason] = useState('');
  const take = useCaseAction(async (client, _: void) => client.call(takeCase, { params: { id: data.id } }));
  const reassign = useCaseAction((client, vars: { toUserId: string; reason: string }) =>
    client.call(reassignCase, { params: { id: data.id }, body: vars }),
  );

  if (data.state === 'DECIDED' || data.state === 'CLOSED') {
    return (
      <Panel heading="Decision recorded">
        {data.decisions.length === 0 ? (
          <p className="text-[12px] text-slate">This case is {stateLabel(data.state).toLowerCase()}.</p>
        ) : (
          data.decisions.map((decision) => (
            <div key={decision.id} className="mb-[10px] text-[12.5px] last:mb-0">
              <b className="block text-[14px]">{decision.outcome}</b>
              <p className="my-[4px]">{decision.reason}</p>
              <p className="font-mono text-[11px] text-trust-gray">
                Applied per {decision.policyCitation} · {whenLabel(decision.decidedAt)}
              </p>
            </div>
          ))
        )}
      </Panel>
    );
  }

  const advisoryBox =
    advisory === undefined ? null : (
      <AdvisoryBox label={advisory.label}>{[advisory.suggestion, ...advisory.rationale]}</AdvisoryBox>
    );

  if (!canManage) {
    return (
      <>
        {advisoryBox}
        <Banner tone="info">Your role can read cases but not decide them.</Banner>
      </>
    );
  }

  if (data.ownerUserId === null) {
    return (
      <Panel heading="Your decision">
        {advisoryBox}
        <p className="mb-[10px] text-[12.5px] text-slate">Nobody owns this case yet. Take it to decide it.</p>
        <Button type="button" disabled={take.isPending} onClick={() => take.mutate()} className={SMALL}>
          Take this case
        </Button>
        <ErrorLine failed={take.isError} what="take this case" />
      </Panel>
    );
  }

  if (data.ownerUserId !== viewerId) {
    return (
      <Panel heading="Your decision">
        {advisoryBox}
        <p className="mb-[10px] text-[12.5px] text-slate">
          {ownerLabel(data.ownerUserId, viewerId)} owns this case. Only its owner can decide it; reassign it
          to yourself, with a reason, to take it over.
        </p>
        <TextField
          label="Reason for reassigning"
          value={reassignReason}
          maxLength={1000}
          onChange={(event) => setReassignReason(event.target.value)}
        />
        <Button
          type="button"
          disabled={!present(reassignReason) || viewerId === undefined || reassign.isPending}
          onClick={() => {
            if (viewerId !== undefined) {
              reassign.mutate({ toUserId: viewerId, reason: reassignReason.trim() });
            }
          }}
          className={`${SMALL} mt-[10px]`}
        >
          Reassign to me
        </Button>
        <ErrorLine failed={reassign.isError} what="reassign this case" />
      </Panel>
    );
  }

  return <DecisionForm data={data} advisory={advisory} />;
}

export function CaseDetail({ caseId }: { caseId: string }): React.JSX.Element {
  const viewerId = useViewerId();
  const canManage = useCanManage();
  const query = useCaseDetail(caseId);
  const data = query.data;

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div role="status" aria-label="Loading the case" className="grid gap-[8px]">
        <Skeleton width="full" />
        <Skeleton width="w80" />
      </div>
    );
  } else if (data === undefined) {
    body = (
      <EmptyState
        tone="error"
        title="We could not load this case"
        body="The case did not load. It may not exist, or your role may not include cases."
        action={
          <Button type="button" onClick={() => void query.refetch()} className={SMALL}>
            Try again
          </Button>
        }
      />
    );
  } else {
    const finished = data.state === 'DECIDED' || data.state === 'CLOSED';
    const tone = clockTone(data.sla);
    body = (
      <CaseLayout
        caseId={data.code}
        subject={data.title}
        parties={`${typeLabel(data.type)} · ${humanise(data.subjectType)} ${data.subjectId} · ${ownerLabel(data.ownerUserId, viewerId)}`}
        status={
          <>
            <Chip tone={finished ? 'resolved' : 'awaiting'} dot>
              {stateLabel(data.state)}
            </Chip>
            {!finished && (
              <Chip tone={tone ?? 'verified'} dot={false}>
                {clockLabel(data.sla)}
              </Chip>
            )}
            <Chip
              tone={data.priority === 'URGENT' || data.priority === 'HIGH' ? 'risk' : 'verified'}
              dot={false}
            >
              {priorityLabel(data.priority)}
            </Chip>
          </>
        }
        evidence={
          <>
            <Facts facts={data.facts} />
            <EvidenceRequests
              caseId={data.id}
              requests={data.evidenceRequests}
              canAct={canManage && !finished}
            />
            <Trail caseId={data.id} />
          </>
        }
        decision={
          <>
            <Decision data={data} canManage={canManage} viewerId={viewerId} />
            {canManage && !finished && <WorkThisCase data={data} />}
          </>
        }
      />
    );
  }

  return (
    <QueueFrame tab={null} title="Case" description="The case, its evidence and the decision.">
      {body}
    </QueueFrame>
  );
}
