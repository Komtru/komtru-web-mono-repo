'use client';

// OP-06 Verification case: the same case layout as every other case. Evidence on the left (what the
// platform knows), the decision on the right (what Komtru suggests, then a person's choice).
//
// The decision is a person's. The advisory arrives with the item (`GET /admin/kyc/queue/:id`), is
// drawn as prose in its own box and is read by nothing else: it never picks an outcome, never fills
// the reason and is never sent. "Record decision" stays disabled until a person has chosen an outcome
// and written a reason. The policy cited is the backend's default (M6 §6.8, or §7 for a duplicate).
//
// A request held by a duplicate-identity flag is not approved or rejected here: the backend refuses
// that on purpose (it would be a way around the dual approval), so the screen offers the flag's own
// resolutions instead. Clearing a false positive is three steps, and the second needs a different
// person: ask, a second holder approves, then clear with that approval.
//
// Not drawn because the platform has no read for it: a person's or business's name, the provider's
// own wording, the document images and the applicant's history. Each is held out of the review
// queue on purpose (T-050, D1) or belongs to a later ticket (merchant documents are T-154).
import {
  ProblemError,
  REJECTION_CODES,
  reassignCase,
  type RejectionCode,
  type CaseDetail as CaseDetailData,
  type CaseTrailEntry,
  type KycQueueDetail,
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
  OptionCard,
  Select,
  Skeleton,
  TextField,
  TrustTrail,
  CONTROL_CLASS,
  type TimelineEvent,
} from '@komtru/ui-kit';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useCaseAction, useCaseDetail, useCaseTrail } from '../cases/hooks';
import { failureMessage, humanise, ownerLabel, priorityLabel, trailLabel, whenLabel } from '../cases/format';
import { useStaffViewer } from '../shell/viewer';
import { dueLabel, evidenceLabel, isBusiness, shortUser, verificationLabel } from './format';
import { kycCalls, useClearances, useKycAction, useKycItem } from './hooks';
import { IdentityFrame } from './shared';

export const PANEL =
  'mb-[16px] rounded-lg border border-solid border-border-hairline bg-surface-elevated p-[20px]';
export const SMALL = 'w-auto!';
const DEFAULT_REJECTION: RejectionCode = 'REVIEW_DECLINED';
/** A duplicate is settled through its flag, and "needs a person" is not a rejection. */
const OFFERED_REJECTIONS = REJECTION_CODES.filter(
  (code) => code !== 'DUPLICATE_IDENTITY' && code !== 'NEEDS_HUMAN_REVIEW',
);

export const present = (value: string): boolean => value.trim() !== '';

export function Panel({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={heading} className={PANEL}>
      <h2 className="mb-[12px] text-[14px] font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

export function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const fieldId = useId();
  return (
    <Field id={fieldId} label={label} helperId={`${fieldId}-helper`}>
      <textarea
        id={fieldId}
        value={value}
        maxLength={1000}
        rows={3}
        placeholder="Say what you saw and why"
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL_CLASS}
      />
    </Field>
  );
}

export function ErrorLine({ error, what }: { error: unknown; what: string }): React.JSX.Element | null {
  return error === null || error === undefined ? null : (
    <Banner tone="risk" className="mt-[10px]">
      {failureMessage(error, what)}
    </Banner>
  );
}

function factValue(value: string | number | boolean | null, key: string): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && (key === 'reason' || key === 'verificationType')) {
    return key === 'verificationType' ? verificationLabel(value) : humanise(value);
  }
  return String(value);
}

function Evidence({
  item,
  detail,
  allowed,
}: {
  item: KycQueueDetail;
  detail: CaseDetailData | undefined;
  allowed: boolean;
}): React.JSX.Element {
  return (
    <section aria-label="Evidence" className={PANEL}>
      <h2 className="mb-[12px] text-[14px] font-semibold">Evidence</h2>
      {!allowed ? (
        <p className="text-[12px] text-slate">
          Your role does not include the case evidence and the Trust Trail.
        </p>
      ) : detail === undefined ? (
        <p role="status" className="text-[12px] text-slate">
          Loading the evidence…
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-[12.5px]">
          <caption className="sr-only">What the review case records</caption>
          <thead>
            <tr className="text-[11px] text-slate">
              <th scope="col" className="pb-[6px] font-semibold">
                Check
              </th>
              <th scope="col" className="pb-[6px] font-semibold">
                Result
              </th>
              <th scope="col" className="pb-[6px] font-semibold">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(detail.facts).map(([key, value]) => (
              <tr key={key} className="border-t border-solid border-border-hairline">
                <th scope="row" className="py-[9px] font-semibold">
                  {evidenceLabel(key)}
                </th>
                <td className="py-[9px]">{factValue(value, key)}</td>
                <td className="py-[9px] text-[11.5px] text-slate">Review case</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-[10px] text-[11.5px] text-slate">
        {isBusiness(item.caseType) ? 'Business' : 'Individual'} · user {shortUser(item.userId)} · submitted{' '}
        {whenLabel(item.submittedAt)}
      </p>
    </section>
  );
}

const trailEvents = (entries: CaseTrailEntry[], viewerId: string | undefined): TimelineEvent[] =>
  entries.map((entry) => ({
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

function Trail({ caseId, viewerId }: { caseId: string; viewerId: string | undefined }): React.JSX.Element {
  const trail = useCaseTrail(caseId);
  if (trail.failed) {
    return (
      <Panel heading="Trust Trail">
        <p className="text-[12px] text-slate">The Trust Trail did not load. Reload the page to try again.</p>
      </Panel>
    );
  }
  return (
    <>
      <TrustTrail
        events={trailEvents(trail.entries, viewerId)}
        empty={trail.loading ? 'Loading the Trust Trail…' : undefined}
      />
      {trail.hasMore && (
        <Button
          type="button"
          variant="secondary"
          disabled={trail.loadingMore}
          onClick={trail.loadMore}
          className={`${SMALL} mt-[10px]`}
        >
          {trail.loadingMore ? 'Loading…' : 'Load older'}
        </Button>
      )}
    </>
  );
}

function Advisory({ item }: { item: KycQueueDetail }): React.JSX.Element {
  return (
    <AdvisoryBox label={item.advisory.label}>
      {[item.advisory.suggestion, ...item.advisory.rationale]}
    </AdvisoryBox>
  );
}

/** Take it, or (for someone who manages cases) take it over. Nothing is decided until the viewer owns the case. */
function Ownership({
  item,
  canManage,
  viewerId,
}: {
  item: KycQueueDetail;
  canManage: boolean;
  viewerId: string | undefined;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const take = useKycAction(kycCalls.assign);
  const reassign = useCaseAction((client, vars: { toUserId: string; reason: string }) =>
    client.call(reassignCase, { params: { id: item.caseId }, body: vars }),
  );

  if (item.ownerUserId === null) {
    return (
      <Panel heading="Your decision">
        <p className="mb-[10px] text-[12.5px] text-slate">Nobody owns this case yet. Take it to decide it.</p>
        <Button
          type="button"
          disabled={take.isPending}
          onClick={() => take.mutate(item.requestId)}
          className={SMALL}
        >
          Take this case
        </Button>
        <ErrorLine error={take.error} what="take this case" />
      </Panel>
    );
  }
  return (
    <Panel heading="Your decision">
      <p className="mb-[10px] text-[12.5px] text-slate">
        {ownerLabel(item.ownerUserId, viewerId)} owns this case. Only its owner can decide it.
        {canManage ? ' Reassign it to yourself, with a reason, to take it over.' : ''}
      </p>
      {canManage && (
        <>
          <TextField
            label="Reason for reassigning"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            type="button"
            disabled={!present(reason) || viewerId === undefined || reassign.isPending}
            onClick={() => {
              if (viewerId !== undefined) reassign.mutate({ toUserId: viewerId, reason: reason.trim() });
            }}
            className={`${SMALL} mt-[10px]`}
          >
            Reassign to me
          </Button>
          <ErrorLine error={reassign.error} what="reassign this case" />
        </>
      )}
    </Panel>
  );
}

function DecisionForm({ item }: { item: KycQueueDetail }): React.JSX.Element {
  const [outcome, setOutcome] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState<RejectionCode>(DEFAULT_REJECTION);
  const decide = useKycAction(kycCalls.decide);
  const complete = outcome !== null && present(reason);
  return (
    <DecisionPanel
      heading="Your decision"
      advisory={[item.advisory.suggestion, ...item.advisory.rationale]}
      advisoryLabel={item.advisory.label}
      policy={{ policy: 'M6', section: '6.8' }}
      footnote="Your reason is saved to the Trust Trail."
      actions={
        <>
          <OptionCard
            name={`outcome-${item.requestId}`}
            value="APPROVE"
            checked={outcome === 'APPROVE'}
            onChange={() => setOutcome('APPROVE')}
          >
            Approve
          </OptionCard>
          <OptionCard
            name={`outcome-${item.requestId}`}
            value="REJECT"
            checked={outcome === 'REJECT'}
            onChange={() => setOutcome('REJECT')}
          >
            Reject
          </OptionCard>
          {outcome === 'REJECT' && (
            <Select
              label="What the person is told"
              value={code}
              onChange={(event) => setCode(event.target.value as RejectionCode)}
              options={OFFERED_REJECTIONS.map((value) => ({ value, label: humanise(value) }))}
            />
          )}
          <TextArea label="Reason" value={reason} onChange={setReason} />
          <Button
            type="button"
            disabled={!complete || decide.isPending}
            onClick={() => {
              if (outcome !== null) {
                decide.mutate({
                  requestId: item.requestId,
                  outcome,
                  reason: reason.trim(),
                  ...(outcome === 'REJECT' && code !== DEFAULT_REJECTION ? { rejectionCode: code } : {}),
                });
              }
            }}
          >
            Record decision
          </Button>
          <ErrorLine error={decide.error} what="record the decision" />
        </>
      }
    />
  );
}

function FlagResolution({
  item,
  canOverride,
}: {
  item: KycQueueDetail;
  canOverride: boolean;
}): React.JSX.Element | null {
  const flagId = item.duplicateFlagId;
  const [reason, setReason] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const resolve = useKycAction(kycCalls.resolve);
  const ask = useKycAction(kycCalls.askClearance);
  const approved = useClearances('APPROVED', item.userId, item.caseNumber, canOverride && flagId !== null);
  if (flagId === null) return null;

  const busy = resolve.isPending || ask.isPending;
  const usable = approved.data ?? [];
  const escalated = item.duplicateFlagStatus === 'ESCALATED';
  const refused = resolve.error instanceof ProblemError && resolve.error.status === 403;

  return (
    <DecisionPanel
      heading="Resolve the duplicate flag"
      policy={{ policy: 'M6', section: '7' }}
      footnote="Clearing a flag moves an identity between accounts, so a second person must approve it first."
      actions={
        <>
          <TextArea label="Reason" value={reason} onChange={setReason} />
          <div className="flex flex-wrap gap-[8px]">
            <Button
              type="button"
              disabled={!present(reason) || busy}
              onClick={() =>
                resolve.mutate({ flagId, resolution: 'CONFIRMED_DUPLICATE', reason: reason.trim() })
              }
              className={SMALL}
            >
              Confirm duplicate
            </Button>
            {!escalated && (
              <Button
                type="button"
                variant="secondary"
                disabled={!present(reason) || busy}
                onClick={() => resolve.mutate({ flagId, resolution: 'ESCALATED', reason: reason.trim() })}
                className={SMALL}
              >
                Escalate
              </Button>
            )}
          </div>

          <div className="mt-[8px] grid gap-[8px] border-t border-solid border-border-hairline pt-[12px]">
            <b className="text-[12.5px]">Clear as a false positive</b>
            {!canOverride ? (
              <p className="text-[12px] text-slate">
                Clearing needs a second approver, and asking for one needs the verification override
                permission, which your role does not include.
              </p>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!present(reason) || busy}
                  onClick={() => ask.mutate({ flagId, reason: reason.trim() })}
                  className={SMALL}
                >
                  Ask for a second approver
                </Button>
                {ask.data !== undefined && (
                  <p className="text-[12px] text-slate">
                    Asked. A different holder approves it under “Clearance approvals”; then it appears below
                    to clear the flag with.
                  </p>
                )}
                <Select
                  label="Approved clearance"
                  value={approvalId}
                  onChange={(event) => setApprovalId(event.target.value)}
                  options={[
                    {
                      value: '',
                      label: usable.length === 0 ? 'None approved yet' : 'Choose an approved clearance',
                    },
                    ...usable.map((row) => ({
                      value: row.id,
                      label: `${row.reason} (approved ${row.approvedAt === null ? '' : whenLabel(row.approvedAt)})`,
                    })),
                  ]}
                />
                <Button
                  type="button"
                  disabled={approvalId === '' || !present(reason) || busy}
                  onClick={() =>
                    resolve.mutate({
                      flagId,
                      resolution: 'CLEARED_FALSE_POSITIVE',
                      reason: reason.trim(),
                      approvalId,
                    })
                  }
                  className={SMALL}
                >
                  Clear the flag
                </Button>
              </>
            )}
          </div>
          {refused && escalated ? (
            <Banner tone="risk" className="mt-[10px]">
              You escalated this flag, so a different reviewer or a senior role must resolve it. Reassign the
              case to them.
            </Banner>
          ) : (
            <ErrorLine error={resolve.error} what="resolve the flag" />
          )}
          <ErrorLine error={ask.error} what="ask for a second approver" />
        </>
      }
    />
  );
}

/**
 * The second half of a clearance, for anyone holding `verification.override` on a flagged case, owner
 * or not. The requests come from the platform's own list, so nobody pastes an id and a second person
 * sees what they are being asked to approve. The backend refuses self-approval (T-037); the screen
 * says so rather than offering a button that can only fail.
 */
function ClearanceApprovals({
  item,
  viewerId,
}: {
  item: KycQueueDetail;
  viewerId: string | undefined;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const pending = useClearances('PENDING', item.userId, item.caseNumber, true);
  const approve = useKycAction(kycCalls.approve);
  const rows = pending.data ?? [];

  return (
    <Panel heading="Clearance approvals">
      {pending.isError ? (
        <p className="text-[12px] text-slate">
          The clearance requests did not load. Reload the page to try again.
        </p>
      ) : pending.isPending ? (
        <p role="status" className="text-[12px] text-slate">
          Loading the clearance requests…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-slate">
          Nobody is waiting on a second approver for this flag. A clearance asked for by a colleague appears
          here for you to approve.
        </p>
      ) : (
        <>
          <ul className="m-0 mb-[12px] list-none p-0">
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-b border-solid border-border-hairline py-[10px] text-[12.5px] last:border-b-0"
              >
                <b className="block">{row.reason}</b>
                <span className="text-[11px] text-slate">
                  Asked by {ownerLabel(row.requestedBy, viewerId)} · {whenLabel(row.requestedAt)} · expires{' '}
                  {whenLabel(row.expiresAt)}
                </span>
                {row.requestedBy === viewerId ? (
                  <p className="mt-[6px] text-[12px] text-slate">
                    You asked for this. A different holder must approve it.
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!present(reason) || approve.isPending}
                    onClick={() => approve.mutate({ approvalId: row.id, reason: reason.trim() })}
                    className={`${SMALL} mt-[8px]`}
                  >
                    Approve this clearance
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {rows.some((row) => row.requestedBy !== viewerId) && (
            <TextField
              label="Reason for approving"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </>
      )}
      <ErrorLine error={approve.error} what="approve that clearance" />
    </Panel>
  );
}

function Decision({
  item,
  detail,
  viewerId,
  can,
}: {
  item: KycQueueDetail;
  detail: CaseDetailData | undefined;
  viewerId: string | undefined;
  can: { review: boolean; resolve: boolean; override: boolean; manage: boolean };
}): React.JSX.Element {
  if (item.state === 'DECIDED' || item.state === 'CLOSED') {
    return (
      <Panel heading="Decision recorded">
        {detail === undefined || detail.decisions.length === 0 ? (
          <p className="text-[12px] text-slate">This case is {item.state.toLowerCase()}.</p>
        ) : (
          detail.decisions.map((decision) => (
            <div key={decision.id} className="mb-[10px] text-[12.5px] last:mb-0">
              <b className="block text-[14px]">{humanise(decision.outcome)}</b>
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

  const flagged = item.duplicateFlagStatus === 'OPEN' || item.duplicateFlagStatus === 'ESCALATED';
  const mine = item.ownerUserId !== null && item.ownerUserId === viewerId;

  if (!can.review) {
    return (
      <>
        <Advisory item={item} />
        <Banner tone="info">Your role can read verification cases but not decide them.</Banner>
      </>
    );
  }
  if (flagged) {
    return (
      <>
        <Advisory item={item} />
        <Banner tone="info" className="mb-[16px]">
          A duplicate-identity flag holds this request: the same identifier is already verified on another
          account. It is settled through the flag, not by approving or rejecting here.
        </Banner>
        {!can.resolve ? (
          <Banner tone="info">Your role cannot resolve duplicate-identity flags.</Banner>
        ) : mine ? (
          <FlagResolution item={item} canOverride={can.override} />
        ) : (
          <Ownership item={item} canManage={can.manage} viewerId={viewerId} />
        )}
      </>
    );
  }
  if (!mine) {
    return (
      <>
        <Advisory item={item} />
        <Ownership item={item} canManage={can.manage} viewerId={viewerId} />
      </>
    );
  }
  return <DecisionForm item={item} />;
}

export function VerificationCase({ requestId }: { requestId: string }): React.JSX.Element {
  const viewer = useStaffViewer();
  const viewerId = viewer.me?.user.id;
  const { permissions } = viewer;
  const canView = permissions.has('verification.view');
  const canSeeCase = permissions.has('cases.view');
  const query = useKycItem(requestId, canView);
  const item = query.data;
  const detail = useCaseDetail(item?.caseId ?? '', canSeeCase && item !== undefined);
  const caseData = canSeeCase && item !== undefined ? detail.data : undefined;

  let body: React.ReactNode;
  if (!canView) {
    body = (
      <EmptyState
        title="This verification case is not part of your role"
        body="Your role does not include verification review. If you need it, ask your team lead to review your access."
      />
    );
  } else if (query.isPending) {
    body = (
      <div role="status" aria-label="Loading the verification case" className="grid gap-[8px]">
        <Skeleton width="full" />
        <Skeleton width="w80" />
      </div>
    );
  } else if (item === undefined) {
    body = (
      <EmptyState
        tone="error"
        title="We could not load this verification case"
        body="The case did not load. It may not exist, or your role may not include verification review."
        action={
          <Button type="button" onClick={() => void query.refetch()} className={SMALL}>
            Try again
          </Button>
        }
      />
    );
  } else {
    const finished = item.state === 'DECIDED' || item.state === 'CLOSED';
    const due = dueLabel(item.slaDueAt);
    body = (
      <CaseLayout
        caseId={item.caseNumber}
        subject={`${verificationLabel(item.verificationType)} check`}
        parties={`${isBusiness(item.caseType) ? 'Business check' : 'Identity check'} · user ${shortUser(item.userId)} · ${ownerLabel(item.ownerUserId, viewerId)}`}
        status={
          <>
            <Chip tone={finished ? 'resolved' : 'awaiting'} dot>
              {humanise(item.state)}
            </Chip>
            {!finished && (
              <Chip tone={due.overdue ? 'risk' : 'verified'} dot={false}>
                {due.label}
              </Chip>
            )}
            <Chip
              tone={item.priority === 'URGENT' || item.priority === 'HIGH' ? 'risk' : 'verified'}
              dot={false}
            >
              {priorityLabel(item.priority as Parameters<typeof priorityLabel>[0]) ?? humanise(item.priority)}
            </Chip>
          </>
        }
        evidence={
          <>
            <Evidence item={item} detail={caseData} allowed={canSeeCase} />
            {canSeeCase && <Trail caseId={item.caseId} viewerId={viewerId} />}
          </>
        }
        decision={
          <>
            <Decision
              item={item}
              detail={caseData}
              viewerId={viewerId}
              can={{
                review: permissions.has('verification.review'),
                resolve: permissions.has('duplicate_flag.resolve'),
                override: permissions.has('verification.override'),
                manage: permissions.has('cases.manage'),
              }}
            />
            {permissions.has('verification.override') &&
              (item.duplicateFlagStatus === 'OPEN' || item.duplicateFlagStatus === 'ESCALATED') &&
              !finished && <ClearanceApprovals item={item} viewerId={viewerId} />}
          </>
        }
      />
    );
  }

  return (
    <IdentityFrame
      tab={null}
      title="Verification case"
      description="Verification proves who someone is. It doesn’t make them a trusted seller."
    >
      <Link
        href="/identity"
        aria-label="Back to People"
        className="mb-[12px] inline-flex items-center gap-[10px] text-[12.5px] font-semibold text-slate"
      >
        <span
          aria-hidden
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-solid border-border-hairline bg-surface-primary"
        >
          ‹
        </span>
        People
      </Link>
      {body}
    </IdentityFrame>
  );
}
