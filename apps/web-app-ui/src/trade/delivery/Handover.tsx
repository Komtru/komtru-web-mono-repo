'use client';

import type { UploadTarget } from '@komtru/shared-types';
import { ProblemError, UploadError, uploadFile, type TradeView } from '@komtru/api-client';
import { tradeKeys, useApiClient, useShipSelfArranged } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  InfoCard,
  InfoRow,
  RiskBanner,
  SectionLabel,
  StatusHero,
  TextField,
  WarnBanner,
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addressLine, platformWords } from '../format';
import { ReceiptPicker } from '../shipping/ShipOrder';
import { checkPhone, checkPlate, checkWaybill, normalisePlate } from '../shipping/evidence';
import { dispatchHref, trackHref } from '../workspace-state';
import { Frame, Refusal, TradeGate, tradeHref } from './parts';
import { ReportDelivery } from './ReportDelivery';

const TITLE = 'Hand Over';
/** The waybill receipt is the seller's own private evidence for this trade, never public. */
// Handover is the moment delivery is proved, so the photo is PROOF_OF_DELIVERY rather than the
// `OTHER` escape hatch, which cannot be PRIVATE_CASE.
const RECEIPT: UploadTarget = { category: 'PROOF_OF_DELIVERY', visibility: 'PRIVATE_CASE' };
const PROSE = 'Generate or review the waybill and confirm the courier handover.';

/**
 * CWT-S09 (X2, self-arranged): the seller gives the waybill and the driver, then confirms the courier has the
 * parcel. Confirming is the one call that marks the trade shipped (with the four pieces of evidence the platform
 * requires), so there is no waybill to generate: the seller's own courier issued it.
 */
export function Handover({ id }: { id: string }): React.JSX.Element {
  return (
    <TradeGate
      id={id}
      title={TITLE}
      role="SELLER"
      deniedWhy="Only the seller hands the item over. You can follow its delivery from the trade."
    >
      {(trade) => <ByStatus trade={trade} />}
    </TradeGate>
  );
}

function ByStatus({ trade }: { trade: TradeView }): React.JSX.Element {
  if (trade.status === 'FUNDED') return <HandoverForm trade={trade} />;
  if (
    ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED', 'DISPUTED'].includes(
      trade.status,
    )
  ) {
    return (
      <Frame title={TITLE} id={trade.id}>
        <StatusHero tone="success" as="h2" title="Handover confirmed">
          The buyer can see the item is on its way. Your waybill is kept with the trade.
        </StatusHero>
        <ReportDelivery trade={trade} />
        <ActionStack>
          <Button asChild>
            <a href={trackHref(trade.id)}>Track the delivery</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={tradeHref(trade.id)}>Back to the trade</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  const early = [
    'DRAFT',
    'PENDING_COUNTERPARTY',
    'UNDER_PROPOSAL_REVIEW',
    'AWAITING_ACCEPTANCE',
    'PENDING_PAYMENT',
  ].includes(trade.status);
  if (early) {
    return (
      <Frame title={TITLE} id={trade.id}>
        <WarnBanner title="Dispatch locked">
          Handover opens once the payment is protected. Do not hand the item over before then.
        </WarnBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={tradeHref(trade.id)}>Back to the trade</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }
  return <Refusal id={trade.id} title={TITLE} why="This trade isn’t waiting to be handed over." />;
}

function HandoverForm({ trade }: { trade: TradeView }): React.JSX.Element {
  const ship = useShipSelfArranged();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ waybill: '', phone: '', plate: '' });
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<{ fileId: string; name: string } | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [collected, setCollected] = useState(false);

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
    receipt !== undefined &&
    collected;

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

  const onConfirm = () => {
    // The button is shut while the call runs, and a replay of the same ship is harmless on the platform.
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
            setProblem(platformWords(error, 'We couldn’t confirm the handover. Try again.'));
          }
        },
      },
    );
  };

  const pickup = trade.terms?.shipsFromAddress;
  return (
    <Frame title={TITLE} id={trade.id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">{PROSE}</p>
      <InfoCard aria-label="Handover">
        <InfoRow
          title="Arranged by you"
          detail={
            pickup === undefined || pickup === null
              ? 'Pickup · your address'
              : `Pickup · ${addressLine(pickup)}`
          }
        />
        <InfoRow
          title={values.waybill.trim() === '' ? 'Waybill' : `Waybill ${values.waybill.trim()}`}
          detail={receipt === undefined ? 'Add the details below' : 'Ready for handover'}
        />
      </InfoCard>
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
      <fieldset className="mb-[14px] min-w-0 border-0 p-0">
        <legend className="mb-[8px] p-0">
          <SectionLabel>Handover confirmation</SectionLabel>
        </legend>
        <label className="flex cursor-pointer items-start gap-[10px] rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-primary p-[12px] text-[12.5px] font-semibold has-[:checked]:border-trust-indigo has-[:checked]:bg-trust-indigo-soft">
          <input
            type="checkbox"
            className="mt-[1px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
            checked={collected}
            onChange={(event) => {
              setCollected(event.target.checked);
            }}
          />
          <span>The courier has collected the parcel</span>
        </label>
      </fieldset>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" onClick={onConfirm} disabled={!ready || uploading || ship.isPending}>
          {ship.isPending ? 'Confirming handover…' : 'Confirm handover'}
        </Button>
        <Button asChild variant="secondary">
          <a href={dispatchHref(trade.id)}>Back</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
