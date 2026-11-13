'use client';

import type { TradeView } from '@komtru/api-client';
import {
  tradeKeys,
  useAcceptTrade,
  useAddresses,
  useDeclineTrade,
  usePreviewTrade,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  ItemCard,
  NoteBanner,
  OptionCard,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  TextField,
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AddressPicker } from '../AddressPicker';
import { isProblem, itemSub, itemTitle, naira, partyName, problemMessage } from '../format';
import { ConfirmSheet } from '../parts';
import { ProofReview } from '../proof/ProofReview';
import { Agreement } from './parts';
import { readRequest } from './read';
import { parkAvailable, promiseLabel, waitingKeys } from './request';

/**
 * CT-S6 and CT-S7: a seller started this trade and finished the item, so the specification is locked. The buyer
 * chooses how to receive it (the delivery address; Park is deferred for MVP) with the seller's cost in view, then
 * reviews the whole agreement and accepts. Accepting carries the address, which is the platform's own call for it.
 * The figures are the platform's: the snapshot the trade carries once it has one, else the preview for the same
 * category and price. The delivery charge is the seller's and is its own line, never added into the total.
 */
export function BuyerChoose({ trade }: { trade: TradeView }): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  const preview = usePreviewTrade();
  const addresses = useAddresses();
  const inFlight = useRef(false);
  const [stage, setStage] = useState<0 | 1>(0);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  const terms = trade.terms;
  const request = readRequest(trade);
  const seller =
    trade.counterparty === undefined || trade.counterparty === null
      ? 'The seller'
      : partyName(trade.counterparty);

  const { mutate: runPreview } = preview;
  const category = trade.categoryCode;
  const amountMinor = terms?.itemAmountMinor;
  const hasSnapshot = trade.fees !== null;
  useEffect(() => {
    if (hasSnapshot || category === null || amountMinor === undefined) return;
    runPreview({ role: 'BUYER', categoryCode: category, itemAmountMinor: amountMinor });
  }, [hasSnapshot, category, amountMinor, runPreview]);

  // A stage change unmounts the button that was focused; focus moves to the new stage's heading, not to the page top.
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  if (terms === null)
    return (
      <ScreenColumn>
        <ScreenHeader title="Trade" backHref="/trades" />
      </ScreenColumn>
    );

  // A field still holding `Seller to confirm` is not something the seller said: nothing here can be accepted.
  const waiting = waitingKeys(terms.itemSpec).length > 0;
  const amounts = preview.data?.fees[0]?.snapshot.amounts;
  const fees =
    trade.fees !== null
      ? {
          itemMinor: trade.fees.itemAmountMinor,
          protectionFeeMinor: trade.fees.buyerProtectionFeeMinor,
          totalMinor: trade.fees.buyerTotalMinor,
        }
      : amounts === undefined
        ? undefined
        : {
            itemMinor: amounts.itemMinor,
            protectionFeeMinor: amounts.buyerProtectionFeeMinor,
            totalMinor: amounts.buyerTotalMinor,
          };
  const sub = itemSub(terms.itemSpec);
  const chosen = addresses.data?.find((address) => address.id === addressId);
  const parkOn = parkAvailable();
  const promise = request.deliveryPromise === undefined ? undefined : promiseLabel(request.deliveryPromise);

  const retryPreview = () => {
    if (category === null || amountMinor === undefined) return;
    runPreview({ role: 'BUYER', categoryCode: category, itemAmountMinor: amountMinor });
  };
  // What the buyer pays is the platform's figure; nothing can be accepted until it is on screen.
  const figuresReady = fees !== undefined;

  const onAccept = () => {
    // Synchronous, unlike `isPending`: two taps before React re-renders must not make two acceptances.
    if (inFlight.current || waiting || addressId === null || !figuresReady) return;
    inFlight.current = true;
    setProblem(undefined);
    accept.mutate(
      { id: trade.id, termsVersionId: terms.versionId, addressId },
      {
        onSuccess: () => {
          router.push(`/trade/${trade.id}/fund`);
        },
        onError: (error) => {
          setProblem(problemMessage(error, "We couldn't accept that. Try again."));
          // A newer version arrived: show it, so the next accept is of what is on screen.
          if (isProblem(error, 'CONFLICT'))
            void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id) });
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  const onDecline = () => {
    if (reason.trim().length < 3) return;
    setProblem(undefined);
    decline.mutate(
      { id: trade.id, reason: reason.trim() },
      {
        onSuccess: () => {
          setDeclining(false);
        },
        onError: (error) => {
          setDeclining(false);
          setProblem(problemMessage(error, "We couldn't decline that. Try again."));
        },
      },
    );
  };

  const card = (
    <ItemCard
      title={itemTitle(terms.itemSpec)}
      {...(sub === undefined ? {} : { sub })}
      price={naira(terms.itemAmountMinor)}
    />
  );
  const money = (
    <>
      {fees !== undefined && (
        <TermList
          aria-label="What you pay"
          className="mt-[12px] border-t border-solid border-border-hairline"
        >
          <TermRow label="Item price">{naira(fees.itemMinor)}</TermRow>
          <TermRow label="Buyer Protection Fee">{naira(fees.protectionFeeMinor)}</TermRow>
          {request.deliveryChargeMinor !== undefined && (
            <TermRow label="Delivery (paid to the seller)">{naira(request.deliveryChargeMinor)}</TermRow>
          )}
          <TermRow label="Total due on funding">
            <strong className="text-midnight-text">{naira(fees.totalMinor)}</strong>
          </TermRow>
        </TermList>
      )}
      {fees === undefined && (
        <div role="status" className="mt-[12px]">
          {preview.isError ? (
            <RiskBanner>
              We couldn&apos;t work out what you pay.{' '}
              <button type="button" className="font-semibold underline" onClick={retryPreview}>
                Try again
              </button>
            </RiskBanner>
          ) : (
            <p className="text-[12px] text-slate">Working out what you pay…</p>
          )}
        </div>
      )}
      <p className="mt-[6px] text-[11px] leading-[1.5] text-slate">
        The delivery charge is paid to the seller outside Komtru protection and is not part of this total.
      </p>
    </>
  );

  return (
    <ScreenColumn>
      <ScreenHeader
        title={stage === 0 ? `Trade from ${seller}` : 'Review & Accept'}
        {...(stage === 0
          ? { backHref: '/trades' }
          : {
              onBack: () => {
                setProblem(undefined);
                setStage(0);
              },
            })}
      />

      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {stage === 0 ? 'Choose how to receive it' : 'Review and accept'}
      </h2>

      {stage === 0 && (
        <>
          {waiting ? (
            <NoteBanner title="Still waiting on the seller">
              {seller} hasn&apos;t confirmed the item details yet, so there is nothing to accept.
            </NoteBanner>
          ) : (
            <ReadyBanner title="Item details confirmed by the seller">
              You can&apos;t edit these. If the item doesn&apos;t match, you can raise it during inspection.
            </ReadyBanner>
          )}
          {card}
          <SectionLabel>How would you like to receive it?</SectionLabel>
          <fieldset className="mb-[16px] min-w-0 border-0 p-0">
            <legend className="sr-only">How would you like to receive it?</legend>
            <OptionCard
              name="receive"
              value="COURIER"
              checked
              onChange={() => undefined}
              description={[
                request.deliveryPartner,
                promise === undefined ? undefined : `estimated ${promise}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              Courier
              {request.deliveryChargeMinor === undefined ? '' : ` · ${naira(request.deliveryChargeMinor)}`}
            </OptionCard>
            <OptionCard
              name="receive"
              value="PARK"
              checked={false}
              disabled={!parkOn}
              onChange={() => undefined}
              description={
                parkOn ? 'Collect from a Komtru-supported Park' : 'Coming soon. Courier only for now.'
              }
            >
              Park
            </OptionCard>
          </fieldset>
          <AddressPicker label="Delivering to" value={addressId} onChange={setAddressId} />
          <p className="-mt-[8px] mb-[12px] text-[11.5px] leading-[1.55] text-trust-gray">
            You give your address here; the seller sees it once you accept.
          </p>
          {tried && addressId === null && (
            <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
              Choose an address to carry on.
            </p>
          )}
          {money}
          <ActionStack>
            <Button
              type="button"
              disabled={waiting || !figuresReady}
              onClick={() => {
                setTried(true);
                if (addressId === null) return;
                setTried(false);
                setStage(1);
              }}
            >
              Review agreement
            </Button>
          </ActionStack>
        </>
      )}

      {stage === 1 && (
        <>
          {card}
          <ProofReview seller={seller} total={trade.proofMediaCount} />
          <Agreement
            sellerName={seller}
            sellerLocation={request.sellerLocation}
            itemDetails={request.itemDetails}
            deliveryLine={`Courier · ${chosen === undefined ? 'your address' : `${chosen.streetLine}, ${chosen.cityName}`}`}
            deliveryChargeMinor={request.deliveryChargeMinor}
            deliveryPromise={request.deliveryPromise}
            inspectionHours={terms.inspectionWindowHours}
            categoryName={trade.categoryName ?? undefined}
            fees={fees}
            totalNote="The delivery charge is paid to the seller outside Komtru protection and is not part of this total."
          />
          <p className="mb-[12px] mt-[12px] text-[11px] leading-[1.5] text-trust-gray">
            Accepting locks this version as the agreement. Funds are protected only after you fund the Trade.
          </p>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <ActionStack>
            <Button type="button" onClick={onAccept} disabled={waiting || accept.isPending || !figuresReady}>
              {accept.isPending ? 'Accepting…' : 'Accept & continue to payment'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setProblem(undefined);
                setStage(0);
              }}
            >
              Change delivery
            </Button>
            <Button asChild variant="secondary">
              <a href={`/trade/${trade.id}/counter`}>Propose a change</a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="self-center"
              onClick={() => {
                setDeclining(true);
              }}
            >
              Decline
            </Button>
          </ActionStack>
        </>
      )}
      {stage === 0 && problem !== undefined && <RiskBanner>{problem}</RiskBanner>}

      <ConfirmSheet
        open={declining}
        title="Decline these terms"
        confirm="Decline terms"
        pending={decline.isPending}
        onConfirm={onDecline}
        confirmDisabled={reason.trim().length < 3}
        onClose={() => {
          setDeclining(false);
        }}
      >
        <p className="mb-[12px] text-[12.5px] leading-[1.5] text-slate">
          They&apos;ll see your reason. This ends the trade; nothing has been paid.
        </p>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          {...(reason.trim().length > 0 && reason.trim().length < 3
            ? { helper: 'Give a few words', invalid: true }
            : {})}
        />
      </ConfirmSheet>
    </ScreenColumn>
  );
}
