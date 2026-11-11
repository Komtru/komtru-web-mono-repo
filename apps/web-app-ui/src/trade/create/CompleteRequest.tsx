'use client';

import type { TradeView } from '@komtru/api-client';
import {
  useAddresses,
  useCounterTrade,
  usePinnedStandard,
  usePreviewTrade,
  useTrade,
  tradeKeys,
} from '@komtru/api-client/react';
import { nairaToKobo } from '@komtru/shared-types';
import {
  ActionStack,
  Button,
  ItemCard,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  OptionCard,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TextField,
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AddressPicker } from '../AddressPicker';
import { isProblem, naira, problemMessage, proofNeeds } from '../format';
import { ProofUpload } from '../ProofUpload';
import { Agreement, StageHeader } from './parts';
import { readRequest } from './read';
import { allowedPromises, completedSpec, isRequestSpec } from './request';

const SELLER_STAGES = ['Item details', 'Delivery', 'Review'] as const;
const CONDITIONS = ['Brand new', 'Used · like new', 'Used · good'] as const;

/** A charge in naira as kobo, or `undefined`. Nothing is charged for delivery at zero, which is allowed. */
const parseCharge = (text: string): bigint | undefined => {
  if (text.trim() === '') return undefined;
  try {
    return nairaToKobo(text);
  } catch {
    return undefined;
  }
};

/**
 * CT-B7 to CT-B9: the seller completes the buyer's request. Everything here is the seller's to say: the item
 * specification, the partner and charge, the promise. It is sent back as one counter against the revision they read,
 * so a request that moved meanwhile fails rather than lands on terms the seller never saw.
 */
export function CompleteRequest({ id }: { id: string }): React.JSX.Element {
  const trade = useTrade(id);
  if (trade.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Item Details" backHref={`/trade/${id}`} />
        <LoadingScreen label="Loading the request" />
      </ScreenColumn>
    );
  }
  if (trade.isError) {
    return (
      <LoadFailed
        title="Couldn't open this request"
        body={problemMessage(trade.error, 'Check your connection and try again.')}
        {...(isProblem(trade.error, 'NOT_FOUND') ? {} : { onRetry: () => void trade.refetch() })}
      />
    );
  }
  const view = trade.data;
  const mine = view.yourRole === 'SELLER' && view.awaiting === 'YOU' && view.terms !== null;
  if (!mine || !isRequestSpec(view.terms?.itemSpec)) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Item Details" backHref={`/trade/${id}`} />
        <NoteBanner>There is nothing for you to complete on this trade right now.</NoteBanner>
        <ActionStack>
          <Button asChild variant="secondary">
            <a href={`/trade/${id}`}>Back to the trade</a>
          </Button>
        </ActionStack>
      </ScreenColumn>
    );
  }
  return <Completion trade={view} />;
}

function Completion({ trade }: { trade: TradeView }): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const standard = usePinnedStandard(trade.standardVersionId);
  const addresses = useAddresses();
  const preview = usePreviewTrade();
  const counter = useCounterTrade();
  const request = readRequest(trade);
  const park = request.mode === 'PARK';
  const terms = trade.terms;

  const [stage, setStage] = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<string[]>([]);
  const [counts, setCounts] = useState({ photos: 0, videos: 0 });
  const [partner, setPartner] = useState('');
  const [charge, setCharge] = useState('');
  const [promise, setPromise] = useState('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const { mutate: runPreview } = preview;
  const category = trade.categoryCode;
  const amountMinor = terms?.itemAmountMinor;
  useEffect(() => {
    if (category === null || amountMinor === undefined) return;
    runPreview({ role: 'SELLER', categoryCode: category, itemAmountMinor: amountMinor });
  }, [category, amountMinor, runPreview]);

  if (standard.isPending && trade.standardVersionId !== null) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Item Details" backHref={`/trade/${trade.id}`} />
        <LoadingScreen label="Loading what this category needs" />
      </ScreenColumn>
    );
  }
  if (standard.isError || standard.data === undefined || terms === null) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Item Details" backHref={`/trade/${trade.id}`} />
        <LoadFailed
          title="Couldn't load what this category needs"
          body="Check your connection and try again."
          onRetry={() => void standard.refetch()}
        />
      </ScreenColumn>
    );
  }
  const spec = standard.data;

  const needs = proofNeeds(spec.proofMedia);
  const proofMet = counts.photos >= needs.photos && (!needs.video || counts.videos >= 1);
  const missingField = spec.itemSpecFields.find(
    (field) => field.required && (fields[field.key] ?? '').trim() === '',
  );
  const chargeMinor = parseCharge(charge);
  const promises = allowedPromises(spec.deliveryDeadlineDays);
  const chosenAddress = addresses.data?.find((address) => address.id === addressId);
  const itemOk = missingField === undefined && proofMet;
  const deliveryOk =
    chargeMinor !== undefined && promise !== '' && addressId !== null && (park || partner.trim() !== '');

  const answer = () => ({
    fields,
    delivery: {
      mode: park ? ('PARK' as const) : ('COURIER' as const),
      ...(park ? {} : { partner }),
      chargeMinor: (chargeMinor ?? 0n).toString(),
      promise,
    },
  });

  const advance = () => {
    setTried(true);
    if (stage === 0 && !itemOk) return;
    if (stage === 1 && !deliveryOk) return;
    setTried(false);
    setStage((current) => Math.min(current + 1, 2));
  };

  const submit = () => {
    if (addressId === null) return;
    setProblem(undefined);
    counter.mutate(
      {
        id: trade.id,
        expectedRevision: trade.statusRevision,
        itemSpec: completedSpec((terms.itemSpec ?? {}) as Record<string, unknown>, answer()),
        addressId,
        ...(proof.length > 0 ? { proofFileIds: proof } : {}),
      },
      {
        onSuccess: () => {
          router.push(`/trade/${trade.id}`);
        },
        onError: (error) => {
          setProblem(problemMessage(error, "We couldn't send that back. Try again."));
          // The request moved on while the seller was filling it in: read the latest, so the next try is made
          // against the revision on screen.
          if (isProblem(error, 'CONFLICT'))
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
        },
      },
    );
  };

  const amounts = preview.data?.fees[0]?.snapshot.amounts;
  const titles = ['Item Details', 'Delivery', 'Review'];

  return (
    <ScreenColumn>
      <ScreenHeader
        title={titles[stage] ?? 'Item Details'}
        {...(stage === 0
          ? { backHref: `/trade/${trade.id}` }
          : {
              onBack: () => {
                setTried(false);
                setStage((current) => current - 1);
              },
            })}
      />
      <StageHeader stages={SELLER_STAGES} current={stage} heading={titles[stage] ?? 'Item Details'} />

      {stage === 0 && (
        <>
          <p className="mb-[16px] mt-0 text-[12.5px] leading-[1.5] text-slate">
            {spec.categoryName} specification. These details become the accepted specification — the evidence
            if something is disputed later.
          </p>
          {spec.itemSpecFields.map((field) =>
            field.key === 'condition' ? (
              <fieldset key={field.key} className="mb-[16px] min-w-0 border-0 p-0">
                <legend className="mb-[6px] p-0 text-[13px] font-semibold">
                  {field.required ? field.label : `${field.label} (optional)`}
                </legend>
                {CONDITIONS.map((condition) => (
                  <OptionCard
                    key={condition}
                    name="condition"
                    value={condition}
                    checked={fields.condition === condition}
                    onChange={() => {
                      setFields((current) => ({ ...current, condition }));
                    }}
                  >
                    {condition}
                  </OptionCard>
                ))}
                {tried && field.required && (fields.condition ?? '') === '' && (
                  <p role="alert" className="text-[12px] font-semibold text-risk-on-soft">
                    Choose the condition to carry on.
                  </p>
                )}
              </fieldset>
            ) : (
              <TextField
                key={field.key}
                label={field.required ? field.label : `${field.label} (optional)`}
                value={fields[field.key] ?? ''}
                onChange={(event) => {
                  setFields((current) => ({ ...current, [field.key]: event.target.value }));
                }}
                invalid={tried && field.required && (fields[field.key] ?? '').trim() === ''}
              />
            ),
          )}
          <SectionLabel>Photos of the item</SectionLabel>
          <ProofUpload
            required={needs.photos}
            requireVideo={needs.video}
            onChange={(ids, summary) => {
              setProof(ids);
              setCounts(summary);
            }}
            step="send"
          />
          {tried && !itemOk && (
            <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
              {missingField === undefined
                ? 'Add the photos and video to carry on.'
                : `Add the ${missingField.label.toLowerCase()} to carry on.`}
            </p>
          )}
        </>
      )}

      {stage === 1 && (
        <>
          <p className="mb-[16px] mt-0 text-[12.5px] leading-[1.5] text-slate">
            {park
              ? `The buyer chose to collect at a Park: ${request.parkName ?? 'the Park they chose'}.`
              : `The buyer asked for courier delivery to ${request.deliveryLine.replace(/^Courier · /, '')}.`}
          </p>
          {!park && (
            <TextField
              label="Delivery partner"
              placeholder="The courier you will use"
              value={partner}
              onChange={(event) => {
                setPartner(event.target.value);
              }}
              invalid={tried && partner.trim() === ''}
            />
          )}
          <TextField
            label={park ? 'Delivery charge' : 'Delivery charge (₦)'}
            inputMode="decimal"
            placeholder="₦2,500"
            value={charge}
            onChange={(event) => {
              setCharge(event.target.value);
            }}
            invalid={tried && chargeMinor === undefined}
            helper={
              tried && chargeMinor === undefined
                ? 'Enter the delivery charge in naira, for example 2,500'
                : park
                  ? 'You set this. The buyer sees it before accepting.'
                  : 'The buyer sees the cost before accepting.'
            }
          />
          <fieldset className="mb-[16px] min-w-0 border-0 p-0">
            <legend className="mb-[6px] p-0 text-[13px] font-semibold">When will you deliver?</legend>
            {promises.length === 0 && (
              <p className="text-[12px] text-slate">
                No delivery promise fits this category&apos;s deadline. Contact support.
              </p>
            )}
            {promises.map((range) => (
              <OptionCard
                key={range.value}
                name="promise"
                value={range.value}
                checked={promise === range.value}
                onChange={() => {
                  setPromise(range.value);
                }}
              >
                {range.label}
              </OptionCard>
            ))}
            <p className="mt-[4px] text-[11.5px] text-slate">
              Ranges shown are the ones Komtru allows for {spec.categoryName} by {park ? 'Park' : 'courier'}.
            </p>
            {tried && promise === '' && (
              <p role="alert" className="text-[12px] font-semibold text-risk-on-soft">
                Choose when you will deliver.
              </p>
            )}
          </fieldset>
          <AddressPicker label="Ships from" value={addressId} onChange={setAddressId} />
          {tried && addressId === null && (
            <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
              Choose where it ships from to carry on.
            </p>
          )}
        </>
      )}

      {stage === 2 && (
        <>
          <ItemCard
            title={
              fields.brand !== undefined || fields.model !== undefined
                ? [fields.brand, fields.model].filter(Boolean).join(' ')
                : (request.requestedItem ?? 'Item')
            }
            sub={
              Object.entries(fields)
                .filter(([key, value]) => key !== 'brand' && key !== 'model' && value.trim() !== '')
                .map(([, value]) => value.trim())
                .join(' · ') || undefined
            }
            price={naira(terms.itemAmountMinor)}
          />
          <Agreement
            sellerName="You"
            sellerLocation={
              chosenAddress === undefined
                ? undefined
                : `${chosenAddress.streetLine}, ${chosenAddress.cityName}`
            }
            itemDetails={
              [...Object.values(fields)].filter((value) => value.trim() !== '').join(' · ') ||
              'Confirmed by you'
            }
            deliveryLine={request.deliveryLine}
            collectionPhone={request.collectionPhone}
            deliveryChargeMinor={(chargeMinor ?? 0n).toString()}
            deliveryPromise={promise}
            inspectionHours={terms.inspectionWindowHours}
            categoryName={spec.categoryName}
            fees={
              amounts === undefined
                ? undefined
                : {
                    itemMinor: amounts.itemMinor,
                    protectionFeeMinor: amounts.buyerProtectionFeeMinor,
                    totalMinor: amounts.buyerTotalMinor,
                  }
            }
            totalNote="The delivery charge is paid to the seller outside Komtru protection and is not part of this total."
          />
          <NoteBanner>
            Once you send this, the buyer reviews and accepts. Nothing is final until they do and fund the
            Trade.
          </NoteBanner>
        </>
      )}

      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {stage < 2 ? (
          <Button type="button" onClick={advance}>
            {stage === 1 ? 'Review' : 'Continue'}
          </Button>
        ) : (
          <>
            <Button type="button" onClick={submit} disabled={counter.isPending}>
              {counter.isPending ? 'Sending…' : 'Confirm & send to buyer'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStage(0);
              }}
            >
              Edit
            </Button>
          </>
        )}
      </ActionStack>
    </ScreenColumn>
  );
}
