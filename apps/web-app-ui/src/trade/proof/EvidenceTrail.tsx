'use client';

// PM-6 and PM-8: what the Trade holds as evidence. The seller's agreed proof is fixed and everything new is added beside
// it, each group saying who added it and when (PM-6); once the Trade is complete the same media is kept as a record
// (PM-8). Both read what the platform recorded and draw nothing it did not: no hub scans, no inspection photos, no
// retention period, because none is recorded.
import type { TradeView } from '@komtru/api-client';
import { useInspection, useTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  Chip,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  OfflineBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { isProblem, problemMessage, whenLabel } from '../format';
import { ItemSummary } from '../parts';
import { type GridItem, MediaGrid } from './MediaGrid';
import { useOnline } from './online';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

const tradeHref = (id: string) => `/trade/${id}`;
/** The statuses from which the platform shows the proof and the delivery evidence (the same list it reads from). */
const EVIDENCE_VISIBLE = new Set([
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'COMPLETED',
  'SETTLED',
  'DISPUTED',
  'RESOLVED_REFUNDED',
  'RESOLVED_RELEASED',
]);
const COMPLETE = new Set(['COMPLETED', 'SETTLED', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED']);

const SIGNAL: Record<string, string> = {
  SELLER_SELF_REPORT: 'Reported delivered by the seller',
  BUYER_CONFIRMATION: 'Confirmed by the buyer',
};

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;
const CAPTION = 'mt-[6px] mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray';

function Frame({
  title,
  id,
  code,
  children,
}: {
  title: string;
  id: string;
  code?: string | undefined;
  children: React.ReactNode;
}) {
  const online = useOnline();
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={tradeHref(id)} backLabel="Back to the trade" />
      {code !== undefined && <p className="mb-[10px] text-[11px] text-slate">{code}</p>}
      {!online && (
        <OfflineBanner title="You’re offline">
          You can’t open the evidence until you’re back online.
        </OfflineBanner>
      )}
      {children}
    </ScreenColumn>
  );
}

/** What is read, and what a screen says while it is not there yet or cannot be there. */
function useEvidence(id: string) {
  const trade = useTrade(id);
  const visible = trade.data !== undefined && EVIDENCE_VISIBLE.has(trade.data.status);
  const inspection = useInspection(id, visible);
  return { trade, inspection, visible };
}

function Loading({ title, id, label }: { title: string; id: string; label: string }): React.JSX.Element {
  return (
    <Frame title={title} id={id}>
      <LoadingScreen label={label} />
    </Frame>
  );
}

function Failed({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  // Only the two people in the Trade can open its evidence: a refusal is final, not something trying again fixes.
  const closed = isProblem(error, 'NOT_FOUND') || isProblem(error, 'FORBIDDEN');
  return (
    <LoadFailed
      title={closed ? 'Only the people in this Trade can see its evidence' : 'Couldn’t open the evidence'}
      body={
        closed
          ? 'Check you’re signed in to the account that’s in this Trade.'
          : problemMessage(error, 'Check your connection and try again.')
      }
      {...(closed ? {} : { onRetry: retry })}
    />
  );
}

const proofItems = (read: Read): GridItem[] =>
  (read.sellerProof?.media ?? []).map((file, index) => ({
    id: file.fileId,
    fileId: file.fileId,
    label: `Seller’s proof ${String(index + 1)}`,
  }));

const BackToTrade = ({ id }: { id: string }): React.JSX.Element => (
  <ActionStack>
    <Button asChild variant="secondary">
      <a href={tradeHref(id)}>Back to the Trade</a>
    </Button>
  </ActionStack>
);

/** PM-6: what was shown, what was added and by whom. */
export function EvidenceTrail({ id }: { id: string }): React.JSX.Element {
  const { trade, inspection, visible } = useEvidence(id);
  const title = 'Trade Evidence';
  if (trade.isPending) return <Loading title={title} id={id} label="Loading the trade" />;
  if (trade.data === undefined) return <Failed error={trade.error} retry={() => void trade.refetch()} />;
  const view = trade.data;
  if (visible && inspection.isPending) return <Loading title={title} id={id} label="Loading the evidence" />;
  if (visible && inspection.data === undefined) {
    return <Failed error={inspection.error} retry={() => void inspection.refetch()} />;
  }
  const read = inspection.data;
  return (
    <Frame title={title} id={id} code={view.tradeCode}>
      <Trail trade={view} read={read} />
      <BackToTrade id={id} />
    </Frame>
  );
}

function Trail({ trade, read }: { trade: TradeView; read: Read | undefined }): React.JSX.Element {
  const proof = read === undefined ? [] : proofItems(read);
  const shipment = read?.deliveryEvidence.selfArranged ?? null;
  const signals = read?.deliveryEvidence.signals ?? [];
  const receipt = shipment?.receiptFileId;
  const buyer = trade.yourRole === 'BUYER';
  return (
    <>
      <SectionLabel>Seller’s proof</SectionLabel>
      <div className="mb-[6px]">
        <Chip tone="verified">Fixed when the Trade was agreed</Chip>
      </div>
      {read === undefined ? (
        <NoteBanner title={`${count(trade.proofMediaCount, 'photo or video', 'photos or videos')} shown`}>
          The files open once the item has shipped. Until then they’re held with the Trade.
        </NoteBanner>
      ) : proof.length === 0 ? (
        <p className="mt-[10px] mb-[14px] text-[12px] text-slate">No proof was attached to this Trade.</p>
      ) : (
        <MediaGrid aria-label="Seller’s proof" items={proof} className="mt-[10px]" />
      )}
      {trade.acceptedAt !== null && (
        <p className={CAPTION}>Agreed {whenLabel(trade.acceptedAt)}. It can’t be changed or removed.</p>
      )}

      {shipment !== null && (
        <>
          <SectionLabel>Added by the seller · dispatch</SectionLabel>
          {receipt !== undefined && (
            <MediaGrid
              aria-label="Dispatch"
              items={[{ id: receipt, fileId: receipt, label: 'Waybill photo' }]}
            />
          )}
          <p className={CAPTION}>
            Waybill {shipment.waybillNumber} · {whenLabel(shipment.shippedAt)}
            {receipt === undefined ? '' : ' · waybill photo included'}
          </p>
        </>
      )}

      {signals.length > 0 && (
        <>
          <SectionLabel>Added at delivery</SectionLabel>
          <TermList aria-label="Delivery record">
            {signals.map((signal) => (
              <TermRow key={`${signal.source}-${signal.reportedAt ?? ''}`} label="Delivery">
                {SIGNAL[signal.source] ?? 'Delivery recorded'}
                {signal.reportedAt === undefined ? '' : ` · ${whenLabel(signal.reportedAt)}`}
              </TermRow>
            ))}
          </TermList>
        </>
      )}

      {buyer && (
        <>
          <SectionLabel>Your inspection photos</SectionLabel>
          <p className={CAPTION}>
            Photos you take at inspection aren’t kept with the Trade yet. Use them to compare, from the
            inspection screen.
          </p>
        </>
      )}
    </>
  );
}

/** PM-8: after completion, the media kept with the Trade. */
export function TradeRecord({ id }: { id: string }): React.JSX.Element {
  const { trade, inspection, visible } = useEvidence(id);
  const title = 'Trade Record';
  if (trade.isPending) return <Loading title={title} id={id} label="Loading the trade" />;
  if (trade.data === undefined) return <Failed error={trade.error} retry={() => void trade.refetch()} />;
  const view = trade.data;
  if (!COMPLETE.has(view.status)) {
    return (
      <Frame title={title} id={id}>
        <NoteBanner title="The record is kept when the Trade is complete">
          Until then, what the Trade holds so far is on its evidence page.
        </NoteBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={`${tradeHref(id)}/evidence`}>View all evidence</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  if (visible && inspection.isPending) return <Loading title={title} id={id} label="Loading the record" />;
  if (inspection.data === undefined) {
    return <Failed error={inspection.error} retry={() => void inspection.refetch()} />;
  }
  const read = inspection.data;
  const proof = proofItems(read);
  const shipment = read.deliveryEvidence.selfArranged;
  const signals = read.deliveryEvidence.signals ?? [];
  const refunded = view.status.includes('REFUNDED');
  return (
    <Frame title={title} id={id}>
      <ItemSummary trade={view} />
      <div className="mb-[4px]">
        <Chip tone="verified">{refunded ? 'Refunded' : 'Completed'}</Chip>
      </div>
      <SectionLabel>Evidence kept with this Trade</SectionLabel>
      <TermList aria-label="Evidence kept with this Trade">
        <TermRow label="Seller’s proof">
          {proof.length === 0 ? 'None attached' : count(proof.length, 'photo or video', 'photos or videos')}
        </TermRow>
        {shipment !== null && (
          <TermRow label="Dispatch">
            {shipment.receiptFileId === undefined ? 'Waybill noted' : '1 photo · waybill'}
          </TermRow>
        )}
        {signals.length > 0 && (
          <TermRow label="Delivery">{count(signals.length, 'record', 'records')}</TermRow>
        )}
      </TermList>
      {proof.length > 0 && <MediaGrid aria-label="Seller’s proof" items={proof.slice(0, 4)} columns={4} />}
      <NoteBanner>
        Only the two people in the Trade and Komtru can see it. If the seller edits the listing later, this
        doesn’t change.
      </NoteBanner>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={`${tradeHref(id)}/evidence`}>View all evidence</a>
        </Button>
        <Button asChild variant="ghost">
          <a href="/trades" className="mx-auto block text-center">
            Back to Trades
          </a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
