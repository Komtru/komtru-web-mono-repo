'use client';

import { ProblemError, UploadError, uploadFile, type TradeView } from '@komtru/api-client';
import {
  useApiClient,
  useDeliveryDeadline,
  useShipOptions,
  useShipSelfArranged,
  useTrade,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  StatusHero,
  TextField,
  VersionTimeline,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { isProblem, partyName, problemMessage, whenLabel } from '../format';
import { ItemSummary } from '../parts';
import { Deadline } from '../workspace/shared';

/** Before the escrow is funded the seller is told to wait (X1); the platform's dispatch guard says the same. */
const BEFORE_FUNDING = [
  'DRAFT',
  'PENDING_COUNTERPARTY',
  'UNDER_PROPOSAL_REVIEW',
  'AWAITING_ACCEPTANCE',
  'PENDING_PAYMENT',
];
/** The trade has left the seller's hands: shipped, or on from there towards settlement. */
const SHIPPED_ONWARD = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED'];

/** The waybill receipt is the seller's own private evidence for this trade, never public. */
const RECEIPT = { category: 'OTHER', visibility: 'PRIVATE_CASE' } as const;

const tradeHref = (id: string) => `/trade/${id}`;

/** The platform's own sentence when it sent one (a refused receipt, a passed deadline), else ours. */
const platformWords = (error: unknown, fallback: string): string =>
  error instanceof ProblemError && error.problem.detail !== undefined
    ? error.problem.detail
    : problemMessage(error, fallback);

/**
 * F-026 (Seller-3, X1, X2): the seller hands the item over and says so, with proof. Which state shows is the
 * trade's status: locked until the escrow is funded (X1), the evidence form while it is `FUNDED`, and the
 * confirmation once it has moved on. Self-arranged shipping only: Park and courier companies are not part of
 * the MVP, so no option for them is drawn even if the platform lists one.
 */
export function ShipOrder({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);

  if (trade.isPending) {
    return (
      <Frame title="Ship order" id={id}>
        <LoadingScreen label="Loading the trade" />
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
  const view = trade.data;
  if (view.yourRole !== 'SELLER') {
    return <Nothing id={id} code={view.tradeCode} why="Only the seller ships a trade." />;
  }
  if (BEFORE_FUNDING.includes(view.status)) return <DispatchLocked trade={view} />;
  if (SHIPPED_ONWARD.includes(view.status)) return <Shipped trade={view} />;
  if (view.status !== 'FUNDED') {
    return <Nothing id={id} code={view.tradeCode} why="This trade isn’t waiting to be shipped." />;
  }
  return <ShipForm trade={view} />;
}

/** X1: the guard, drawn. Nothing on this screen can be tapped to ship. */
function DispatchLocked({ trade }: { trade: TradeView }): React.JSX.Element {
  const buyer =
    trade.counterparty === undefined || trade.counterparty === null
      ? undefined
      : partyName(trade.counterparty);
  return (
    <Frame title={trade.tradeCode} id={trade.id}>
      <WarnBanner title="Dispatch Locked · Awaiting Escrow">
        {buyer ?? 'The buyer'} hasn’t funded this trade yet — you’ll be told the moment they do.
      </WarnBanner>
      <ItemSummary trade={trade} />
      <VersionTimeline
        aria-label="Where this trade stands"
        steps={[
          {
            id: 'agreed',
            title: 'Agreement reached',
            ...(trade.acceptedAt === null ? {} : { detail: whenLabel(trade.acceptedAt) }),
            state: 'done',
          },
          { id: 'escrow', title: 'Escrow locked', detail: 'Not yet funded', state: 'active' },
          { id: 'shipped', title: 'Shipped / in transit', detail: 'Locked until funded', state: 'pending' },
        ]}
      />
      <ActionStack className="mt-[16px]">
        <Button type="button" disabled>
          Dispatch locked
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** The trade is on its way: the screen says so and is done. */
function Shipped({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <Frame title={`Ship ${trade.tradeCode}`} id={trade.id}>
      <StatusHero tone="success" as="h2" title="Marked as shipped">
        The buyer can see the item is on its way. Your waybill is kept with the trade.
      </StatusHero>
      <ActionStack>
        <Button asChild>
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** Seller-3 with X2's evidence: waybill number, a photo of the receipt, the driver's phone and the plate. */
function ShipForm({ trade }: { trade: TradeView }): React.JSX.Element {
  const options = useShipOptions(trade.id);
  const deadline = useDeliveryDeadline(trade.id, true);
  const ship = useShipSelfArranged();
  const client = useApiClient();
  const [waybill, setWaybill] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [receipt, setReceipt] = useState<{ fileId: string; name: string } | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (options.isPending) {
    return (
      <Frame title={`Ship ${trade.tradeCode}`} id={trade.id}>
        <LoadingScreen label="Loading the ways to ship" />
      </Frame>
    );
  }
  if (options.isError) {
    return (
      <Frame title={`Ship ${trade.tradeCode}`} id={trade.id}>
        <RiskBanner>
          {platformWords(options.error, 'We couldn’t load the ways to ship. Try again.')}
        </RiskBanner>
        <ActionStack>
          <Button type="button" variant="secondary" onClick={() => void options.refetch()}>
            Try again
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  // The platform lists Park first, with the reason when it is not available. Park and couriers are out of the
  // MVP, so only the seller's own arrangement is acted on.
  const own = options.data.options.find((option) => option.kind === 'SELF_ARRANGED' && option.available);
  if (own === undefined) {
    return (
      <Nothing
        id={trade.id}
        code={trade.tradeCode}
        why="Shipping with your own arrangement isn’t available for this trade. Contact support if you need to ship it."
      />
    );
  }

  const ready =
    waybill.trim().length >= 3 && phone.trim() !== '' && plate.trim() !== '' && receipt !== undefined;

  const onReceipt = async (file: File | undefined) => {
    if (file === undefined) return;
    setFailure(undefined);
    setUploading(true);
    try {
      const fileId = await uploadFile(client, file, RECEIPT);
      setReceipt({ fileId, name: file.name });
    } catch (error) {
      setFailure(
        error instanceof UploadError && error.reason === 'TOO_LARGE'
          ? `${file.name} is too large. Choose a smaller photo.`
          : `${file.name} didn’t upload. Check your connection and add it again.`,
      );
    } finally {
      setUploading(false);
    }
  };

  const onShip = () => {
    if (receipt === undefined) return;
    setProblem(undefined);
    ship.mutate(
      {
        id: trade.id,
        waybillNumber: waybill.trim(),
        receiptFileId: receipt.fileId,
        driverPhone: phone.trim(),
        vehiclePlate: plate.trim(),
      },
      {
        onError: (error) => {
          setProblem(platformWords(error, 'We couldn’t mark it shipped. Try again.'));
        },
      },
    );
  };

  return (
    <Frame title={`Ship ${trade.tradeCode}`} id={trade.id}>
      <ReadyBanner title="Logistics: ready to ship">
        Funds are protected. Ship to release them to you.
      </ReadyBanner>
      <Deadline
        label="Ship by"
        noun="delivery deadline"
        query={deadline}
        at={deadline.data?.deadline?.dueAt}
      />
      <ItemSummary trade={trade} />
      <NoteBanner>
        You arrange the delivery yourself. Collection is confirmed from the waybill, so keep the receipt.
      </NoteBanner>
      <SectionLabel>Waybill and driver</SectionLabel>
      <TextField
        label="Waybill number"
        value={waybill}
        onChange={(event) => {
          setWaybill(event.target.value);
        }}
        autoComplete="off"
      />
      <ReceiptPicker
        receipt={receipt}
        uploading={uploading}
        failure={failure}
        onPick={(file) => void onReceipt(file)}
        onClear={() => {
          setReceipt(undefined);
        }}
      />
      <TextField
        label="Driver or rider phone"
        inputMode="tel"
        value={phone}
        onChange={(event) => {
          setPhone(event.target.value);
        }}
      />
      <TextField
        label="Vehicle registration plate"
        value={plate}
        onChange={(event) => {
          setPlate(event.target.value);
        }}
        autoComplete="off"
      />
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" onClick={onShip} disabled={!ready || uploading || ship.isPending}>
          {ship.isPending ? 'Marking as shipped…' : 'Mark as shipped'}
        </Button>
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** One photo of the waybill receipt: picked, uploaded straight to private storage, and shown by its file name. */
function ReceiptPicker({
  receipt,
  uploading,
  failure,
  onPick,
  onClear,
}: {
  receipt: { fileId: string; name: string } | undefined;
  uploading: boolean;
  failure: string | undefined;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="mb-[14px]">
      {failure !== undefined && <RiskBanner>{failure}</RiskBanner>}
      <label className="block cursor-pointer rounded-md border-[1.5px] border-dashed border-border-hairline bg-surface-primary p-[16px] text-center focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]">
        <b className="block text-[12px]">
          {uploading
            ? 'Uploading…'
            : receipt === undefined
              ? 'Waybill receipt photo'
              : 'Replace the receipt photo'}
        </b>
        <span className="text-[10.5px] text-slate">
          A clear photo of the receipt the courier or park gave you
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            onPick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {receipt !== undefined && (
        <p className="mt-[8px] flex items-center justify-between text-[12px] text-midnight-text">
          <span>{receipt.name}</span>
          <button type="button" className="text-slate underline" onClick={onClear}>
            Remove
          </button>
        </p>
      )}
    </div>
  );
}

function Nothing({ id, code, why }: { id: string; code: string; why: string }): React.JSX.Element {
  return (
    <Frame title={`Ship ${code}`} id={id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.5] text-slate">{why}</p>
      <ActionStack>
        <Button asChild variant="secondary">
          <a href={tradeHref(id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

function Frame({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={tradeHref(id)} backLabel="Back to the trade" />
      {children}
    </ScreenColumn>
  );
}
