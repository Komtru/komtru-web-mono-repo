'use client';

import { ProblemError, UploadError, uploadFile, type TradeView } from '@komtru/api-client';
import {
  tradeKeys,
  useApiClient,
  useDeliveryDeadline,
  useReportDelivered,
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
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isProblem, partyName, platformWords, problemMessage, whenLabel } from '../format';
import { ItemSummary } from '../parts';
import { Deadline } from '../workspace/shared';
import { checkPhone, checkPlate, checkWaybill, normalisePlate } from './evidence';

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

/** A failure: the risk banner is already a live alert. */
const Alert = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <RiskBanner>{children}</RiskBanner>
);

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

/** X1: the guard, drawn, in the words of where the trade really is. Nothing here can be tapped to ship. */
function DispatchLocked({ trade }: { trade: TradeView }): React.JSX.Element {
  const buyer =
    trade.counterparty === undefined || trade.counterparty === null
      ? undefined
      : partyName(trade.counterparty);
  const funded = trade.status === 'PENDING_PAYMENT';
  const accepting = trade.status === 'AWAITING_ACCEPTANCE';
  const body = funded
    ? `${buyer ?? 'The buyer'} hasn’t funded this trade yet — you’ll be told the moment they do.`
    : accepting
      ? 'This trade hasn’t been accepted yet. Respond to the request first; shipping opens once it is agreed and funded.'
      : 'This trade hasn’t been agreed yet. Shipping opens once it is agreed and the buyer has funded it.';
  return (
    <Frame title={trade.tradeCode} id={trade.id}>
      <WarnBanner title={funded ? 'Dispatch Locked · Awaiting Escrow' : 'Dispatch Locked · Not Yet Agreed'}>
        {body}
      </WarnBanner>
      <ItemSummary trade={trade} />
      <VersionTimeline
        aria-label="Where this trade stands"
        steps={[
          funded
            ? {
                id: 'agreed',
                title: 'Agreement reached',
                ...(trade.acceptedAt === null ? {} : { detail: whenLabel(trade.acceptedAt) }),
                state: 'done' as const,
              }
            : {
                id: 'agreed',
                title: accepting ? 'Waiting for your answer' : 'Agreement',
                detail: accepting ? 'Not yet accepted' : 'Not yet agreed',
                state: 'active' as const,
              },
          {
            id: 'escrow',
            title: 'Escrow locked',
            detail: 'Not yet funded',
            state: funded ? ('active' as const) : ('pending' as const),
          },
          { id: 'shipped', title: 'Shipped / in transit', detail: 'Locked until funded', state: 'pending' },
        ]}
      />
      <ActionStack className="mt-[16px]">
        <Button type="button" disabled>
          Dispatch locked
        </Button>
        {accepting && (
          <Button asChild>
            <a href={tradeHref(trade.id)}>Respond to this request</a>
          </Button>
        )}
        <Button asChild variant="secondary">
          <a href={tradeHref(trade.id)}>Back to the trade</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}

/** The trade is on its way (or reported delivered): the seller can say it arrived, once. */
function Shipped({ trade }: { trade: TradeView }): React.JSX.Element {
  const report = useReportDelivered();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const reported = trade.status === 'UNCONFIRMED_DELIVERY';
  const onReport = () => {
    setProblem(undefined);
    report.mutate(trade.id, {
      onError: (error) => {
        setProblem(platformWords(error, 'We couldn’t report the delivery. Try again.'));
      },
    });
  };
  return (
    <Frame title={`Ship ${trade.tradeCode}`} id={trade.id}>
      {reported ? (
        <StatusHero tone="success" as="h2" title="Delivery reported">
          The buyer has been asked to confirm it arrived.
        </StatusHero>
      ) : (
        <StatusHero tone="success" as="h2" title="Marked as shipped">
          The buyer can see the item is on its way. Your waybill is kept with the trade. When it has arrived,
          report the delivery so the buyer can confirm.
        </StatusHero>
      )}
      {problem !== undefined && <Alert>{problem}</Alert>}
      <ActionStack>
        {trade.status === 'SHIPPED' && (
          <Button type="button" onClick={onReport} disabled={report.isPending}>
            {report.isPending ? 'Reporting…' : 'Report delivery'}
          </Button>
        )}
        <Button asChild variant={trade.status === 'SHIPPED' ? 'secondary' : 'primary'}>
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
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ waybill: '', phone: '', plate: '' });
  const [touched, setTouched] = useState<readonly string[]>([]);
  // What the platform said about a field when it refused; cleared the moment the person edits that field.
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<{ fileId: string; name: string } | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // A 409 means the trade is not where this screen thought it was (shipped meanwhile, or the dispatch guard):
  // read the trade again and let its status choose the screen. The platform's words stay until it does.
  const optionsConflict = options.error instanceof ProblemError && options.error.status === 409;
  useEffect(() => {
    if (optionsConflict) {
      void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id), exact: true });
    }
  }, [optionsConflict, queryClient, trade.id]);

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
        <Alert>{platformWords(options.error, 'We couldn’t load the ways to ship. Try again.')}</Alert>
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

  const checks = {
    waybill: checkWaybill(values.waybill),
    phone: checkPhone(values.phone),
    plate: checkPlate(values.plate),
  };
  const platformKey = { waybill: 'waybillNumber', phone: 'driverPhone', plate: 'vehiclePlate' } as const;
  const errorOf = (field: keyof typeof checks): string | undefined =>
    (touched.includes(field) ? checks[field] : undefined) ?? refused[platformKey[field]];
  const ready =
    checks.waybill === undefined &&
    checks.phone === undefined &&
    checks.plate === undefined &&
    receipt !== undefined;

  const bind = (field: keyof typeof checks, label: string, extra: { inputMode?: 'tel' } = {}) => {
    const error = errorOf(field);
    return {
      label,
      value: values[field],
      autoComplete: 'off',
      ...extra,
      invalid: error !== undefined,
      ...(error === undefined ? {} : { helper: error }),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setValues((current) => ({ ...current, [field]: event.target.value }));
        setRefused((current) => ({ ...current, [platformKey[field]]: '' }));
      },
      onBlur: () => {
        setTouched((current) => (current.includes(field) ? current : [...current, field]));
      },
    };
  };

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
    if (receipt === undefined || !ready) return;
    setProblem(undefined);
    setRefused({});
    ship.mutate(
      {
        id: trade.id,
        waybillNumber: values.waybill.trim(),
        receiptFileId: receipt.fileId,
        driverPhone: values.phone.trim(),
        vehiclePlate: normalisePlate(values.plate),
      },
      {
        onError: (error) => {
          if (error instanceof ProblemError && error.status === 409) {
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id), exact: true });
          }
          const fields = error instanceof ProblemError ? (error.problem.errors ?? []) : [];
          if (fields.length > 0) {
            const byPath = Object.fromEntries(fields.map((item) => [item.path, item.message]));
            setRefused(byPath);
            if (byPath.receiptFileId !== undefined) {
              setReceipt(undefined);
              setFailure(`${byPath.receiptFileId}. Add the receipt photo again.`);
            }
          } else {
            setProblem(platformWords(error, 'We couldn’t mark it shipped. Try again.'));
          }
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
      <TextField {...bind('waybill', 'Waybill number')} />
      <ReceiptPicker
        receipt={receipt}
        uploading={uploading}
        failure={failure}
        onPick={(file) => void onReceipt(file)}
        onClear={() => {
          setReceipt(undefined);
        }}
      />
      <TextField {...bind('phone', 'Driver or rider phone', { inputMode: 'tel' })} />
      <TextField {...bind('plate', 'Vehicle registration plate')} />
      {problem !== undefined && <Alert>{problem}</Alert>}
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
export function ReceiptPicker({
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
      {failure !== undefined && <Alert>{failure}</Alert>}
      <label className="block cursor-pointer rounded-md border-[1.5px] border-dashed border-border-hairline bg-surface-primary p-[16px] text-center focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]">
        <b className="block text-[12px]">
          {uploading
            ? 'Uploading…'
            : receipt === undefined
              ? 'Waybill receipt photo'
              : 'Replace the receipt photo'}
        </b>
        <span role="status" className="sr-only">
          {uploading ? 'Uploading the receipt photo' : ''}
        </span>
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
            Remove<span className="sr-only"> {receipt.name}</span>
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
