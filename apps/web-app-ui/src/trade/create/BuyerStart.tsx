'use client';

import {
  classifyParty,
  lookupParty,
  type LookupResult,
  type TradeStandard,
  type TradeView,
} from '@komtru/api-client';
import {
  useAddresses,
  useApiClient,
  useCancelTrade,
  useCreateTrade,
  usePreviewTrade,
  useSendTrade,
  useTradeStandards,
} from '@komtru/api-client/react';
import { nairaToKobo } from '@komtru/shared-types';
import {
  ActionStack,
  Button,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
} from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { naira, problemMessage } from '../format';
import { About, ItemAndDelivery, Sent, Terms } from './BuyerStages';
import { Agreement, BUYER_STAGES, StageHeader } from './parts';
import { detectCategory, parkAvailable, requestSpec, type DeliveryMode, type ParkOption } from './request';

export interface BuyerStartProps {
  /** A handle, email or phone to name as the seller, from a link such as a seller's passport. */
  counterparty?: string;
  /** Park collection (CT-B2P). Off until the Park network exists; see `PARK_DELIVERY_ENABLED`. */
  parkEnabled?: boolean;
  parks?: readonly ParkOption[];
}

const parseAmount = (text: string): bigint | undefined => {
  try {
    const kobo = nairaToKobo(text);
    return kobo > 0n ? kobo : undefined;
  } catch {
    return undefined;
  }
};

type Looked = { value: string; result: LookupResult };

/**
 * CT-B1 to CT-B5. The buyer says who, what and roughly how much, and where it should go; the seller supplies the
 * item and the delivery commitments afterwards, so this screen never asks for what the buyer cannot know. Two calls
 * make a request: create the draft, then send it. The draft is kept once it exists, so a send that fails is retried on
 * the same draft and a request edited since is withdrawn and recreated, never sent with terms the buyer has changed.
 */
export function BuyerStart({
  counterparty = '',
  parkEnabled = parkAvailable(),
  parks = [],
}: BuyerStartProps): React.JSX.Element {
  const router = useRouter();
  const client = useApiClient();
  const standards = useTradeStandards();
  const preview = usePreviewTrade();
  const create = useCreateTrade();
  const send = useSendTrade();
  const cancel = useCancelTrade();
  const addresses = useAddresses();

  const [stage, setStage] = useState(0);
  const [who, setWho] = useState(counterparty);
  const [looked, setLooked] = useState<Looked | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [pickedCategory, setPickedCategory] = useState('');
  const [mode, setMode] = useState<DeliveryMode>('COURIER');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [parkId, setParkId] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; inputs: string } | undefined>(undefined);
  const [sent, setSent] = useState<TradeView | undefined>(undefined);

  const list = standards.data;
  const detected = list === undefined ? undefined : detectCategory(title, list);
  const category = detected ?? (pickedCategory === '' ? undefined : pickedCategory);
  const standard: TradeStandard | undefined = list?.find((item) => item.categoryCode === category);
  const kobo = parseAmount(amount);
  const party = useMemo(() => classifyParty(who), [who]);
  const lookedNow =
    looked !== undefined && party !== undefined && looked.value === party.value ? looked.result : undefined;

  // What the fees come to, asked again when the category or price changes; stored nowhere.
  const { mutate: runPreview } = preview;
  useEffect(() => {
    if (category === undefined || kobo === undefined) return;
    runPreview({ role: 'BUYER', categoryCode: category, itemAmountMinor: kobo.toString() });
  }, [category, kobo, runPreview]);
  const canBuy = preview.data === undefined || preview.data.allowedRoles.includes('BUYER');
  const amounts = preview.data?.fees[0]?.snapshot.amounts;

  const check = async (): Promise<LookupResult | undefined> => {
    if (party === undefined) return undefined;
    if (looked?.value === party.value) return looked.result;
    try {
      const result = await lookupParty(client, party);
      setLooked({ value: party.value, result });
      return result;
    } catch (error) {
      setProblem(problemMessage(error, "We couldn't look that person up. Try again."));
      return undefined;
    }
  };

  const sellerName =
    lookedNow?.found === true
      ? (lookedNow.party.merchantName ??
        lookedNow.party.displayName ??
        `@${lookedNow.party.username ?? 'seller'}`)
      : who.trim();
  const phoneOk = /^\+?[\d\s-]{7,20}$/.test(phone.trim());
  const chosenAddress = addresses.data?.find((address) => address.id === addressId);
  const parkName = parks.find((park) => park.id === parkId)?.name;

  if (sent !== undefined) return <Sent trade={sent} sellerName={sellerName} />;
  if (standards.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Start a Trade" backHref="/trades" />
        <LoadingScreen label="Loading the categories" />
      </ScreenColumn>
    );
  }
  if (standards.isError) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Start a Trade" backHref="/trades" />
        <LoadFailed
          title="Couldn't load the categories"
          body="Check your connection and try again."
          onRetry={() => void standards.refetch()}
        />
      </ScreenColumn>
    );
  }
  if (standards.data.length === 0) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Start a Trade" backHref="/trades" />
        <NoteBanner>
          There are no trade categories to choose from yet, so a trade can&apos;t be started. Try again later.
        </NoteBanner>
      </ScreenColumn>
    );
  }

  const cannotInvite = lookedNow?.found === false && !lookedNow.canInvite;

  const next = async () => {
    setTried(true);
    setProblem(undefined);
    if (stage === 0) {
      if (party === undefined || title.trim() === '' || kobo === undefined || standard === undefined) return;
      const found = await check();
      if (found === undefined) return;
      if (!found.found && !found.canInvite) return;
      if (!canBuy) return;
    }
    if (stage === 1) {
      if (mode === 'COURIER' && addressId === null) return;
      if (mode === 'PARK' && (parkId === '' || !phoneOk)) return;
    }
    setTried(false);
    setStage((current) => Math.min(current + 1, 3));
  };

  const submit = async () => {
    if (standard === undefined || kobo === undefined || party === undefined || addressId === null) return;
    setProblem(undefined);
    setBusy(true);
    try {
      const itemSpec = requestSpec(standard, title, {
        deliveryMode: mode,
        ...(mode === 'PARK'
          ? { parkId, ...(parkName === undefined ? {} : { parkName }), contactPhone: phone.trim() }
          : {}),
      });
      const inputs = JSON.stringify([standard.categoryCode, kobo.toString(), itemSpec, addressId]);
      let id = draft?.inputs === inputs ? draft.id : undefined;
      if (id === undefined) {
        if (draft !== undefined) {
          setDraft(undefined);
          await cancel.mutateAsync({ id: draft.id }).catch(() => undefined);
        }
        const created = await create.mutateAsync({
          role: 'BUYER',
          categoryCode: standard.categoryCode,
          itemAmountMinor: kobo.toString(),
          itemSpec,
          addressId,
        });
        id = created.id;
        setDraft({ id, inputs });
      }
      const result = await send.mutateAsync({
        id,
        ...(party.channel === 'USERNAME'
          ? { username: party.value }
          : party.channel === 'EMAIL'
            ? { email: party.value }
            : { phone: party.value }),
      });
      if (result.status === 'AWAITING_ACCEPTANCE' || result.status === 'PENDING_COUNTERPARTY') {
        setSent(result);
      } else {
        router.push(`/trade/${result.id}`);
      }
    } catch (error) {
      setProblem(problemMessage(error, "We couldn't send that request. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setTried(false);
    setProblem(undefined);
    setStage((current) => Math.max(current - 1, 0));
  };

  return (
    <ScreenColumn>
      <ScreenHeader
        title={stage === 3 ? 'Review' : 'Start a Trade'}
        {...(stage === 0 ? { backHref: '/trades' } : { onBack: back })}
      />
      <StageHeader stages={BUYER_STAGES} current={stage} heading={stage === 3 ? 'Review' : 'Start a Trade'} />

      {stage === 0 && (
        <About
          who={who}
          setWho={(value) => {
            setWho(value);
            setProblem(undefined);
          }}
          onCheck={() => void check()}
          party={party !== undefined}
          lookedNow={lookedNow}
          cannotInvite={cannotInvite}
          title={title}
          setTitle={setTitle}
          amount={amount}
          setAmount={setAmount}
          kobo={kobo}
          tried={tried}
          standards={standards.data}
          detected={detected}
          category={category}
          setCategory={setPickedCategory}
          canBuy={canBuy}
          feeNote={
            amounts === undefined
              ? undefined
              : `You pay ${naira(amounts.buyerTotalMinor)} including the ${naira(amounts.buyerProtectionFeeMinor)} protection fee.`
          }
        />
      )}

      {stage === 1 && standard !== undefined && (
        <ItemAndDelivery
          standard={standard}
          title={title}
          mode={mode}
          setMode={setMode}
          addressId={addressId}
          setAddressId={setAddressId}
          parkEnabled={parkEnabled}
          parks={parks}
          parkId={parkId}
          setParkId={setParkId}
          phone={phone}
          setPhone={setPhone}
          phoneOk={phoneOk}
          tried={tried}
        />
      )}

      {stage === 2 && standard !== undefined && <Terms standard={standard} />}

      {stage === 3 && standard !== undefined && kobo !== undefined && (
        <>
          <div className="mb-[12px]">
            <div className="text-[16px] font-semibold">{title.trim()}</div>
            <div className="mt-[2px] text-[11.5px] text-slate">Details to be confirmed by the seller</div>
            <div className="mt-[6px] font-mono text-[20px] font-semibold">{naira(kobo.toString())}</div>
          </div>
          <Agreement
            sellerName={sellerName}
            itemDetails={undefined}
            deliveryLine={
              mode === 'PARK'
                ? `Park · ${parkName ?? 'chosen Park'}`
                : `Courier · ${chosenAddress === undefined ? 'your address' : `${chosenAddress.streetLine}, ${chosenAddress.cityName}`}`
            }
            {...(mode === 'PARK' ? { collectionPhone: phone.trim() } : {})}
            deliveryChargeMinor={undefined}
            deliveryPromise={undefined}
            inspectionHours={standard.inspectionWindowHours}
            categoryName={standard.categoryName}
            fees={
              amounts === undefined
                ? undefined
                : {
                    itemMinor: amounts.itemMinor,
                    protectionFeeMinor: amounts.buyerProtectionFeeMinor,
                    totalMinor: amounts.buyerTotalMinor,
                  }
            }
          />
          <p className="mt-[6px] text-[11px] leading-[1.5] text-slate">
            Delivery: the seller adds it. The total due on funding is confirmed once they have.
          </p>
          <NoteBanner title="Before you send">
            These terms become the shared reference point for this Trade. The seller must accept before funds
            can be protected.
          </NoteBanner>
        </>
      )}

      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {stage < 3 ? (
          <Button type="button" onClick={() => void next()} disabled={busy}>
            {stage === 2 ? 'Review' : 'Continue'}
          </Button>
        ) : (
          <>
            <Button type="button" onClick={() => void submit()} disabled={busy || cannotInvite}>
              {busy ? 'Sending…' : 'Send Trade proposal'}
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
