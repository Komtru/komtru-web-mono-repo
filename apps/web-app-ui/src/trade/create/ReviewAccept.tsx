'use client';

import type { TradeView } from '@komtru/api-client';
import { tradeKeys, useAcceptTrade, useDeclineTrade, usePreviewTrade } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  NoteBanner,
  ReadyBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  TextField,
} from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isProblem, itemSub, itemTitle, naira, partyName, problemMessage } from '../format';
import { ConfirmSheet } from '../parts';
import { Agreement } from './parts';
import { readRequest } from './read';

/**
 * CT-B10. The seller finished the buyer's request; the full cost is visible and the choice is the buyer's. Accepting
 * locks the version on screen as the agreement, then goes on to pay. The figures are the platform's: the snapshot the
 * trade carries once it has one, else the preview for the same category and price.
 */
export function ReviewAccept({ trade }: { trade: TradeView }): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accept = useAcceptTrade();
  const decline = useDeclineTrade();
  const preview = usePreviewTrade();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
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

  if (terms === null)
    return (
      <ScreenColumn>
        <ScreenHeader title="Review & Accept" backHref="/trades" />
      </ScreenColumn>
    );

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

  const onAccept = () => {
    setProblem(undefined);
    accept.mutate(
      { id: trade.id, termsVersionId: terms.versionId },
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
      },
    );
  };

  const onDecline = () => {
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

  return (
    <ScreenColumn>
      <ScreenHeader title="Review & Accept" backHref="/trades" />
      {request.open ? (
        <NoteBanner title="Still waiting on the seller">
          {seller} hasn&apos;t confirmed the item details yet, so there is nothing to accept.
        </NoteBanner>
      ) : (
        <ReadyBanner title={`${seller} confirmed the details`}>
          Item details, delivery cost and promise are now complete.
        </ReadyBanner>
      )}
      <div className="mb-[12px]">
        <div className="text-[16px] font-semibold">{itemTitle(terms.itemSpec)}</div>
        {sub !== undefined && <div className="mt-[2px] text-[11.5px] text-slate">{sub}</div>}
        <div className="mt-[6px] font-mono text-[20px] font-semibold">{naira(terms.itemAmountMinor)}</div>
      </div>
      <Agreement
        sellerName={seller}
        sellerLocation={request.sellerLocation}
        itemDetails={request.itemDetails}
        deliveryLine={request.deliveryLine}
        collectionPhone={request.collectionPhone}
        deliveryChargeMinor={request.deliveryChargeMinor}
        deliveryPromise={request.deliveryPromise}
        inspectionHours={terms.inspectionWindowHours}
        categoryName={trade.categoryName ?? undefined}
        fees={fees}
        totalNote="The delivery charge is shown above and is not part of this total."
      />
      <p className="mb-[12px] mt-[12px] text-[11px] leading-[1.5] text-trust-gray">
        Accepting locks this version as the agreement. Funds are protected only after you fund the Trade.
      </p>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        <Button type="button" onClick={onAccept} disabled={request.open || accept.isPending}>
          {accept.isPending ? 'Accepting…' : 'Accept & continue to payment'}
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
      <ConfirmSheet
        open={declining}
        title="Decline these terms"
        confirm="Decline"
        pending={decline.isPending}
        onConfirm={onDecline}
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
