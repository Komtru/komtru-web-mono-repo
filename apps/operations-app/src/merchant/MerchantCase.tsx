'use client';

// OP-61 as T-154 builds it: a merchant application as a case, on the same layout as every other case
// (AC10). Evidence on the left (the application, its documents viewable inline, the evidence matrix, who
// the applicant is), the decision on the right (what Komtru suggests, then a person's choice).
//
// The decision is a person's. The advisory arrives with the application, is drawn as prose in its own box
// and is read by nothing else: it never picks an outcome, never fills the reason or the policy cited and
// is never sent. "Record decision" stays disabled until a person has chosen an outcome and written both a
// reason and the policy they applied (and, for changes, named at least one document or field). The
// backend refuses a decision without either, and refuses anyone but the case's owner.
//
// What the platform cannot answer is not drawn: OP-61 as the Living Master draws it is a Seller 360 (fulfilment,
// dispute rate, proof quality, recent issues, outreach), post-certification health that no module holds yet.
// The applicant panel carries what the platform can state: verification level and trade history.
import {
  ProblemError,
  reassignCase,
  type CaseTrailEntry,
  type MerchantApplicationDetail,
  type MerchantChangeItem,
} from '@komtru/api-client';
import {
  AdvisoryBox,
  Banner,
  Button,
  CaseLayout,
  Chip,
  DecisionPanel,
  EmptyState,
  EvidenceMatrix,
  OptionCard,
  Skeleton,
  TextField,
  TrustTrail,
  type TimelineEvent,
} from '@komtru/ui-kit';
import Link from 'next/link';
import { useState } from 'react';
import { failureMessage, humanise, ownerLabel, priorityLabel, trailLabel, whenLabel } from '../cases/format';
import { useCaseAction, useCaseTrail } from '../cases/hooks';
import { dueLabel } from '../identity/format';
import { ErrorLine, Panel, SMALL, TextArea, present } from '../identity/VerificationCase';
import { useStaffViewer } from '../shell/viewer';
import {
  DOCUMENT_CHOICES,
  FIELD_CHOICES,
  businessLabel,
  businessTypeLabel,
  changeLabel,
  evidenceRows,
  levelLabel,
  statusLabel,
  statusTone,
} from './format';
import { merchantCalls, useMerchantAction, useMerchantApplication } from './hooks';
import { MERCHANT_HREF, MerchantFrame } from './shared';

type Detail = MerchantApplicationDetail;

const FINISHED = ['APPROVED', 'REJECTED'] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[170px_1fr] gap-[10px] border-t border-solid border-border-hairline py-[8px] text-[12.5px] first:border-t-0">
      <dt className="font-semibold text-slate">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ApplicationPanel({ item }: { item: Detail }): React.JSX.Element {
  const { form } = item;
  const address = [form.addressLine, form.cityName, form.stateName].filter(
    (part) => part !== null && part !== '',
  );
  return (
    <Panel heading="Application">
      <dl>
        <Row label="Business name">{businessLabel(form.businessName)}</Row>
        <Row label="Business type">{businessTypeLabel(form.businessType)}</Row>
        <Row label="Registered address">{address.length > 0 ? address.join(', ') : '—'}</Row>
        <Row label="Categories">
          {form.categories.length > 0 ? form.categories.map((code) => humanise(code)).join(', ') : '—'}
        </Row>
        <Row label="CAC registration number">
          <span className="font-mono">{form.cacRcNumber ?? '—'}</span>
        </Row>
        <Row label="Submitted">
          {item.submittedAt === null ? '—' : whenLabel(item.submittedAt)}
          {item.submissionCount > 1 ? ` · submission ${item.submissionCount}` : ''}
        </Row>
      </dl>
      {item.changesRequested.length > 0 && (
        <Banner tone="info" className="mt-[12px]">
          Waiting on the applicant to change:{' '}
          {item.changesRequested.map((entry) => changeLabel(entry)).join(', ')}.
        </Banner>
      )}
    </Panel>
  );
}

const isImage = (type: string | null): boolean => type !== null && type.startsWith('image/');

function Documents({ item }: { item: Detail }): React.JSX.Element {
  return (
    <Panel heading="Documents">
      {item.documents.length === 0 ? (
        <p className="text-[12px] text-slate">The applicant has not attached any documents.</p>
      ) : (
        <div className="grid gap-[14px]">
          {item.documents.map((document) => (
            <figure key={document.fileId} className="m-0">
              <figcaption className="mb-[6px] flex flex-wrap items-center justify-between gap-[8px] text-[12.5px]">
                <b>{document.label}</b>
                {document.url !== null && (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[11.5px] font-semibold text-trust-indigo"
                  >
                    Open in a new tab
                  </a>
                )}
              </figcaption>
              {document.url === null ? (
                <p className="rounded-md border border-dashed border-border-hairline p-[14px] text-[12px] text-slate">
                  This file is not available. It may have been removed, or your role may not include it.
                </p>
              ) : isImage(document.contentType) ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, never optimised or cached
                <img
                  src={document.url}
                  alt={document.label}
                  className="max-h-[420px] w-full rounded-md border border-solid border-border-hairline object-contain"
                />
              ) : (
                <iframe
                  title={document.label}
                  src={document.url}
                  className="h-[420px] w-full rounded-md border border-solid border-border-hairline"
                />
              )}
            </figure>
          ))}
        </div>
      )}
      <p className="mt-[10px] text-[11.5px] text-slate">
        Every view of a document is recorded against you. The links expire after a few minutes.
      </p>
    </Panel>
  );
}

function ApplicantPanel({ item }: { item: Detail }): React.JSX.Element {
  const { applicant } = item;
  return (
    <Panel heading="Applicant">
      <dl>
        <Row label="Account">
          <span className="font-mono">{applicant.publicId}</span>
          {applicant.username !== null ? ` · @${applicant.username}` : ''}
        </Row>
        <Row label="Verification">
          {levelLabel(applicant.verificationLevelName, applicant.verificationLevel)}
        </Row>
        <Row label="Trade history">
          {applicant.trades.total === 0
            ? 'No trades yet'
            : `${applicant.trades.total} ${applicant.trades.total === 1 ? 'trade' : 'trades'}, ${applicant.trades.completed} completed`}
        </Row>
        <Row label="Member since">{whenLabel(applicant.memberSince)}</Row>
      </dl>
    </Panel>
  );
}

function History({ item }: { item: Detail }): React.JSX.Element {
  return (
    <Panel heading="Status log">
      <ol className="m-0 list-none p-0">
        {item.history.map((entry, index) => (
          <li
            key={`${entry.createdAt}-${entry.toStatus}-${index}`}
            className="border-t border-solid border-border-hairline py-[8px] text-[12.5px] first:border-t-0"
          >
            <b>
              {entry.fromStatus === null ? '' : `${humanise(entry.fromStatus)} → `}
              {humanise(entry.toStatus)}
            </b>
            <span className="text-slate">
              {' '}
              ·{' '}
              {entry.actorType === 'STAFF'
                ? 'Staff'
                : entry.actorType === 'APPLICANT'
                  ? 'Applicant'
                  : 'System'}{' '}
              · {whenLabel(entry.createdAt)}
            </span>
            {entry.reason !== null && <p className="my-[4px]">{entry.reason}</p>}
            {entry.requested.length > 0 && (
              <p className="my-[4px] text-[12px]">
                Asked for: {entry.requested.map((requested) => changeLabel(requested)).join(', ')}
              </p>
            )}
            {entry.policyCitation !== null && (
              <p className="font-mono text-[11px] text-trust-gray">Applied per {entry.policyCitation}</p>
            )}
          </li>
        ))}
      </ol>
    </Panel>
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

const advisoryLines = (item: Detail): string[] => [item.advisory.suggestion, ...item.advisory.rationale];

function Advisory({ item }: { item: Detail }): React.JSX.Element {
  return <AdvisoryBox label={item.advisory.label}>{advisoryLines(item)}</AdvisoryBox>;
}

/** Take it, or (for someone who manages cases) take it over. Nothing is decided until the viewer owns the case. */
function Ownership({
  item,
  canManage,
  viewerId,
}: {
  item: Detail;
  canManage: boolean;
  viewerId: string | undefined;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const take = useMerchantAction(merchantCalls.assign);
  const reassign = useCaseAction((client, vars: { toUserId: string; reason: string }) =>
    client.call(reassignCase, { params: { id: item.caseId }, body: vars }),
  );

  if (item.ownerUserId === null) {
    return (
      <Panel heading="Your decision">
        <p className="mb-[10px] text-[12.5px] text-slate">
          Nobody owns this application yet. Take it to decide it.
        </p>
        <Button
          type="button"
          disabled={take.isPending}
          onClick={() => take.mutate(item.applicationId)}
          className={SMALL}
        >
          Take this application
        </Button>
        <ErrorLine error={take.error} what="take this application" />
      </Panel>
    );
  }
  return (
    <Panel heading="Your decision">
      <p className="mb-[10px] text-[12.5px] text-slate">
        {ownerLabel(item.ownerUserId, viewerId)} owns this application. Only its owner can decide it.
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
          <ErrorLine error={reassign.error} what="reassign this application" />
        </>
      )}
    </Panel>
  );
}

type Outcome = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

const OUTCOME_COPY: Record<Outcome, { label: string; note: string }> = {
  APPROVE: {
    label: 'Approve',
    note: 'Certifies this account in one step: it becomes sell-only (it can no longer take the buyer side of a new trade), gets a storefront address and the Verified Merchant badge, and is told.',
  },
  REQUEST_CHANGES: {
    label: 'Request changes',
    note: 'Sends it back to the applicant with the documents and fields you name. They resubmit, and it returns here as a new submission.',
  },
  REJECT: {
    label: 'Reject',
    note: 'Ends this application. The applicant is told your reason, and may apply again.',
  },
};

function ChangePicker({
  picked,
  onToggle,
}: {
  picked: ReadonlySet<string>;
  onToggle: (kind: MerchantChangeItem['kind'], key: string) => void;
}): React.JSX.Element {
  const group = (
    heading: string,
    kind: MerchantChangeItem['kind'],
    choices: readonly { key: string; label: string }[],
  ) => (
    <fieldset className="m-0 mb-[10px] min-w-0 border-0 p-0">
      <legend className="mb-[4px] text-[12px] font-semibold">{heading}</legend>
      <div className="grid gap-[4px]">
        {choices.map((choice) => (
          <label key={choice.key} className="flex items-center gap-[8px] text-[12.5px]">
            <input
              type="checkbox"
              checked={picked.has(`${kind}:${choice.key}`)}
              onChange={() => onToggle(kind, choice.key)}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div role="group" aria-label="What the applicant should change">
      {group('Documents', 'DOCUMENT', DOCUMENT_CHOICES)}
      {group('Form fields', 'FIELD', FIELD_CHOICES)}
    </div>
  );
}

function DecisionForm({ item }: { item: Detail }): React.JSX.Element {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const approve = useMerchantAction(merchantCalls.approve);
  const reject = useMerchantAction(merchantCalls.reject);
  const changes = useMerchantAction(merchantCalls.requestChanges);
  const pending = approve.isPending || reject.isPending || changes.isPending;

  const toggle = (kind: MerchantChangeItem['kind'], key: string): void => {
    const id = `${kind}:${key}`;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const requested: MerchantChangeItem[] = [...picked].map((id) => {
    const [kind, key] = id.split(':') as [MerchantChangeItem['kind'], string];
    return { kind, key };
  });

  const complete =
    outcome !== null &&
    present(reason) &&
    present(policy) &&
    (outcome !== 'REQUEST_CHANGES' || requested.length > 0);

  const record = (): void => {
    const body = { id: item.applicationId, reason: reason.trim(), policyCitation: policy.trim() };
    if (outcome === 'APPROVE') approve.mutate(body);
    else if (outcome === 'REJECT') reject.mutate(body);
    else if (outcome === 'REQUEST_CHANGES') changes.mutate({ ...body, requested });
  };

  return (
    <DecisionPanel
      heading="Your decision"
      advisory={advisoryLines(item)}
      advisoryLabel={item.advisory.label}
      policy={{
        policy: 'Merchant certification',
        section: '6.3',
        note: 'design, trade roles and certification',
      }}
      footnote="Your reason and the policy you cite are saved to the Trust Trail and the admin action log."
      actions={
        <>
          {(Object.keys(OUTCOME_COPY) as Outcome[]).map((value) => (
            <OptionCard
              key={value}
              name={`outcome-${item.applicationId}`}
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            >
              {OUTCOME_COPY[value].label}
            </OptionCard>
          ))}
          {outcome !== null && <p className="text-[12px] text-slate">{OUTCOME_COPY[outcome].note}</p>}
          {outcome === 'REQUEST_CHANGES' && <ChangePicker picked={picked} onToggle={toggle} />}
          <TextArea label="Reason" value={reason} onChange={setReason} />
          <TextField
            label="Policy cited"
            value={policy}
            maxLength={200}
            placeholder="For example: Design §6.3, CAC documents are mandatory"
            onChange={(event) => setPolicy(event.target.value)}
          />
          <Button type="button" disabled={!complete || pending} onClick={record}>
            Record decision
          </Button>
          <ErrorLine error={approve.error ?? reject.error ?? changes.error} what="record the decision" />
        </>
      }
    />
  );
}

function Decided({ item }: { item: Detail }): React.JSX.Element {
  const last = [...item.history]
    .reverse()
    .find((entry) => entry.actorType === 'STAFF' && entry.reason !== null);
  return (
    <Panel heading="Decision recorded">
      <b className="block text-[14px]">{statusLabel(item.status)}</b>
      {last === undefined ? (
        <p className="mt-[4px] text-[12px] text-slate">
          This application is {statusLabel(item.status).toLowerCase()}.
        </p>
      ) : (
        <div className="mt-[6px] text-[12.5px]">
          <p className="my-[4px]">{last.reason}</p>
          {last.requested.length > 0 && (
            <p className="my-[4px]">
              Asked for: {last.requested.map((entry) => changeLabel(entry)).join(', ')}
            </p>
          )}
          <p className="font-mono text-[11px] text-trust-gray">
            Applied per {last.policyCitation} · {whenLabel(last.createdAt)}
          </p>
        </div>
      )}
    </Panel>
  );
}

function Decision({
  item,
  viewerId,
  can,
}: {
  item: Detail;
  viewerId: string | undefined;
  can: { decide: boolean; manage: boolean };
}): React.JSX.Element {
  const finished =
    (FINISHED as readonly string[]).includes(item.status) || item.status === 'CHANGES_REQUESTED';
  if (finished) {
    return (
      <>
        <Decided item={item} />
        {item.status === 'CHANGES_REQUESTED' && (
          <Banner tone="info">It returns here, as a new submission, when the applicant resubmits.</Banner>
        )}
      </>
    );
  }
  if (!can.decide) {
    return (
      <>
        <Advisory item={item} />
        <Banner tone="info">Your role can read merchant applications but not decide them.</Banner>
      </>
    );
  }
  const mine = item.ownerUserId !== null && item.ownerUserId === viewerId;
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

export function MerchantCase({ applicationId }: { applicationId: string }): React.JSX.Element {
  const viewer = useStaffViewer();
  const viewerId = viewer.me?.user.id;
  const { permissions } = viewer;
  const canView = permissions.has('merchant.application.view');
  const canSeeCase = permissions.has('cases.view');
  const query = useMerchantApplication(applicationId, canView);
  const item = query.data;

  let body: React.ReactNode;
  if (!canView) {
    body = (
      <EmptyState
        title="This application is not part of your role"
        body="Your role does not include merchant applications. If you need them, ask your team lead to review your access."
      />
    );
  } else if (query.isPending) {
    body = (
      <div role="status" aria-label="Loading the merchant application" className="grid gap-[8px]">
        <Skeleton width="full" />
        <Skeleton width="w80" />
      </div>
    );
  } else if (item === undefined) {
    const missing = query.error instanceof ProblemError && query.error.status === 404;
    body = (
      <EmptyState
        tone="error"
        title={missing ? 'There is no such application' : 'We could not load this application'}
        body={
          missing
            ? 'It may not have been submitted yet, or the link is wrong.'
            : 'The application did not load. Your role may not include merchant review.'
        }
        action={
          missing ? undefined : (
            <Button type="button" onClick={() => void query.refetch()} className={SMALL}>
              Try again
            </Button>
          )
        }
      />
    );
  } else {
    const finished = item.caseState === 'DECIDED' || item.caseState === 'CLOSED';
    const due = dueLabel(item.slaDueAt);
    body = (
      <CaseLayout
        caseId={item.caseNumber}
        subject={`${businessLabel(item.form.businessName)} — merchant application`}
        parties={`${businessTypeLabel(item.form.businessType)} · ${item.applicant.publicId} · ${ownerLabel(item.ownerUserId, viewerId)}`}
        status={
          <>
            <Chip tone={statusTone(item.status)} dot>
              {statusLabel(item.status)}
            </Chip>
            {!finished && item.status !== 'CHANGES_REQUESTED' && (
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
            <ApplicationPanel item={item} />
            <Documents item={item} />
            <EvidenceMatrix rows={evidenceRows(item.evidence)} heading="Evidence matrix" />
            <ApplicantPanel item={item} />
            <History item={item} />
            {canSeeCase && <Trail caseId={item.caseId} viewerId={viewerId} />}
          </>
        }
        decision={
          <Decision
            item={item}
            viewerId={viewerId}
            can={{
              decide: permissions.has('merchant.application.decide'),
              manage: permissions.has('cases.manage'),
            }}
          />
        }
      />
    );
  }

  return (
    <MerchantFrame
      title="Merchant application"
      description="Certification lets an account sell as a merchant. It is decided by a person, on the evidence."
    >
      <Link
        href={MERCHANT_HREF}
        aria-label="Back to Merchant Applications"
        className="mb-[12px] inline-flex items-center gap-[10px] text-[12.5px] font-semibold text-slate"
      >
        <span
          aria-hidden
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-solid border-border-hairline bg-surface-primary"
        >
          ‹
        </span>
        Merchant Applications
      </Link>
      {body}
    </MerchantFrame>
  );
}
