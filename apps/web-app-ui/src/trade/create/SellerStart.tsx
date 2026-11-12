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
  ItemCard,
  LoadFailed,
  LoadingScreen,
  NoteBanner,
  OptionCard,
  PartyStrip,
  RiskBanner,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  Select,
  TextField,
  WarnBanner,
} from '@komtru/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AddressPicker } from '../AddressPicker';
import { initialsOf, itemSub, itemTitle, naira, problemMessage, proofNeeds } from '../format';
import { ProofUpload } from '../ProofUpload';
import { KomtruTerms, Sent } from './BuyerStages';
import { Agreement, ItemFields, StageHeader } from './parts';
import { allowedPromises, detectCategory, parkAvailable, parseCharge, sellerSpec } from './request';

export const SELLER_STAGES = ['About', 'Item & delivery', 'Terms', 'Review'] as const;
const TITLE = 'Create Trade';

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
 * CT-S1 to CT-S5. The seller is the authoritative source of the specification, so every item field, the photos and the
 * delivery commitments are asked here; the one thing left is where it goes, which is the buyer's (CT-S6). Two calls
 * make a proposal: create the draft, then send it. The draft is kept once it exists, so a send that fails is retried
 * on the same draft, and a proposal edited since is withdrawn and recreated, never sent with terms the seller changed.
 */
export function SellerStart({
  counterparty = '',
  parkEnabled = parkAvailable(),
}: {
  /** A handle, email or phone to name as the buyer, from a link. */
  counterparty?: string;
  /** Park delivery. Off until the Park network exists; see `PARK_DELIVERY_ENABLED`. */
  parkEnabled?: boolean;
}): React.JSX.Element {
  const client = useApiClient();
  const standards = useTradeStandards();
  const preview = usePreviewTrade();
  const create = useCreateTrade();
  const send = useSendTrade();
  const cancel = useCancelTrade();
  const addresses = useAddresses();

  const inFlight = useRef(false);
  const [stage, setStage] = useState(0);
  const [who, setWho] = useState(counterparty);
  const [looked, setLooked] = useState<Looked | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [pickedCategory, setPickedCategory] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<string[]>([]);
  const [counts, setCounts] = useState({ photos: 0, videos: 0 });
  const [addressId, setAddressId] = useState<string | null>(null);
  const [partner, setPartner] = useState('');
  const [charge, setCharge] = useState('');
  const [promise, setPromise] = useState('');
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; inputs: string } | undefined>(undefined);
  const [sent, setSent] = useState<TradeView | undefined>(undefined);

  const list = standards.data;
  const detected = list === undefined ? undefined : detectCategory(title, list);
  const category = pickedCategory !== '' ? pickedCategory : detected;
  const standard: TradeStandard | undefined = list?.find((item) => item.categoryCode === category);
  const fashion = list?.find((item) => item.categoryCode === 'fashion');
  const kobo = parseAmount(amount);
  const party = useMemo(() => classifyParty(who), [who]);
  const lookedNow =
    looked !== undefined && party !== undefined && looked.value === party.value ? looked.result : undefined;

  // What the fees come to, asked again when the category or price changes; stored nowhere.
  const { mutate: runPreview } = preview;
  useEffect(() => {
    if (category === undefined || kobo === undefined) return;
    runPreview({ role: 'SELLER', categoryCode: category, itemAmountMinor: kobo.toString() });
  }, [category, kobo, runPreview]);
  const canSell = preview.data === undefined || preview.data.allowedRoles.includes('SELLER');
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

  const buyerName =
    lookedNow?.found === true
      ? (lookedNow.party.displayName ??
        lookedNow.party.merchantName ??
        `@${lookedNow.party.username ?? 'buyer'}`)
      : who.trim();
  const merchantBuyer = lookedNow?.found === true && !lookedNow.party.canBuy;
  const cannotInvite = lookedNow?.found === false && !lookedNow.canInvite;

  if (sent !== undefined) return <Sent trade={sent} sellerName={buyerName} role="SELLER" />;
  if (standards.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title={TITLE} backHref="/trades" />
        <LoadingScreen label="Loading the categories" />
      </ScreenColumn>
    );
  }
  if (standards.isError) {
    return (
      <ScreenColumn>
        <ScreenHeader title={TITLE} backHref="/trades" />
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
        <ScreenHeader title={TITLE} backHref="/trades" />
        <NoteBanner>
          There are no trade categories to choose from yet, so a trade can&apos;t be started. Try again later.
        </NoteBanner>
      </ScreenColumn>
    );
  }

  const needs = standard === undefined ? { photos: 0, video: false } : proofNeeds(standard.proofMedia);
  const proofMet = counts.photos >= needs.photos && (!needs.video || counts.videos >= 1);
  const missingField = standard?.itemSpecFields.find(
    (field) => field.required && (fields[field.key] ?? '').trim() === '',
  );
  const itemOk = standard !== undefined && missingField === undefined && proofMet && addressId !== null;
  const chargeMinor = parseCharge(charge);
  const promises = standard === undefined ? [] : allowedPromises(standard.deliveryDeadlineDays);
  const termsOk = chargeMinor !== undefined && promise !== '' && partner.trim() !== '';
  const shipsFrom = addresses.data?.find((address) => address.id === addressId);

  const next = async () => {
    setTried(true);
    setProblem(undefined);
    if (stage === 0) {
      if (party === undefined || title.trim() === '' || kobo === undefined || standard === undefined) return;
      const found = await check();
      if (found === undefined) return;
      if (!found.found && !found.canInvite) return;
      if (found.found && !found.party.canBuy) return;
      if (!canSell) return;
    }
    if (stage === 1 && !itemOk) return;
    if (stage === 2 && !termsOk) return;
    setTried(false);
    setStage((current) => Math.min(current + 1, 3));
  };

  const back = () => {
    setTried(false);
    setProblem(undefined);
    setStage((current) => Math.max(current - 1, 0));
  };

  const submit = async () => {
    // Synchronous, unlike `busy`: two taps before React re-renders must not make two drafts.
    if (inFlight.current) return;
    if (
      standard === undefined ||
      kobo === undefined ||
      party === undefined ||
      addressId === null ||
      chargeMinor === undefined
    )
      return;
    // Checked again here, not only at each Continue: Edit can change an earlier stage after a later one passed.
    if (!itemOk) {
      setTried(true);
      setStage(1);
      return;
    }
    if (!termsOk) {
      setTried(true);
      setStage(2);
      return;
    }
    inFlight.current = true;
    setProblem(undefined);
    setBusy(true);
    try {
      const itemSpec = sellerSpec(standard, title, fields, {
        partner,
        chargeMinor: chargeMinor.toString(),
        promise,
      });
      const proofFileIds = proof.length > 0 ? proof : undefined;
      const inputs = JSON.stringify([
        standard.categoryCode,
        kobo.toString(),
        itemSpec,
        addressId,
        proofFileIds,
      ]);
      let id = draft?.inputs === inputs ? draft.id : undefined;
      if (id === undefined) {
        if (draft !== undefined) {
          setDraft(undefined);
          await cancel.mutateAsync({ id: draft.id }).catch(() => undefined);
        }
        const created = await create.mutateAsync({
          role: 'SELLER',
          categoryCode: standard.categoryCode,
          itemAmountMinor: kobo.toString(),
          itemSpec,
          addressId,
          ...(proofFileIds === undefined ? {} : { proofFileIds }),
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
        ...(proofFileIds === undefined ? {} : { proofFileIds }),
      });
      setSent(result);
    } catch (error) {
      setProblem(problemMessage(error, "We couldn't send that. Check the details and try again."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const heading = stage === 3 ? 'Review' : TITLE;
  const reviewSpec =
    standard === undefined || chargeMinor === undefined
      ? undefined
      : sellerSpec(standard, title, fields, { partner, chargeMinor: chargeMinor.toString(), promise });

  return (
    <ScreenColumn>
      <ScreenHeader title={heading} {...(stage === 0 ? { backHref: '/trades' } : { onBack: back })} />
      <StageHeader stages={SELLER_STAGES} current={stage} heading={heading} />

      {stage === 0 && (
        <>
          <h2 className="m-0 text-[18px] font-semibold">Who are you trading with?</h2>
          <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">
            Enter the buyer&apos;s @username, email or phone number and we&apos;ll match their profile.
          </p>
          <TextField
            label="Who's the buyer?"
            autoComplete="off"
            placeholder="@username, email or phone"
            value={who}
            onChange={(event) => {
              setWho(event.target.value);
              setProblem(undefined);
            }}
            onBlur={() => void check()}
            invalid={tried && party === undefined}
            helper={
              tried && party === undefined
                ? 'Enter their @username, email address or phone number'
                : undefined
            }
          />
          {lookedNow?.found === true && (
            <PartyStrip
              name={
                lookedNow.party.displayName ??
                lookedNow.party.merchantName ??
                `@${lookedNow.party.username ?? 'member'}`
              }
              initials={initialsOf(
                lookedNow.party.displayName ??
                  lookedNow.party.merchantName ??
                  lookedNow.party.username ??
                  'K',
              )}
              meta={`Profile found · ${String(lookedNow.party.completedTrades)} completed trade${lookedNow.party.completedTrades === 1 ? '' : 's'}`}
            />
          )}
          {merchantBuyer && (
            <WarnBanner title="They can't be the buyer">
              This is a certified merchant. Merchants sell on Komtru; they don&apos;t buy. Name someone else.
            </WarnBanner>
          )}
          {lookedNow?.found === false && lookedNow.canInvite && (
            <NoteBanner>
              They aren&apos;t on Komtru that we can see. They&apos;re invited to join, and the proposal waits
              for them when they sign up with this phone number or email.
            </NoteBanner>
          )}
          {cannotInvite && (
            <WarnBanner title="We can't find that username">
              Check the spelling, or use their phone number or email so we can invite them.
            </WarnBanner>
          )}
          <SectionLabel>What are you selling?</SectionLabel>
          <TextField
            label="Item"
            placeholder="iPhone 13 Pro, 256GB"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            invalid={tried && title.trim() === ''}
            helper={tried && title.trim() === '' ? 'Say what you are selling' : undefined}
          />
          <TextField
            label="Agreed price"
            inputMode="decimal"
            placeholder="₦452,000"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            invalid={tried && kobo === undefined}
            helper={
              tried && kobo === undefined
                ? 'Enter the price in naira, for example 452,000'
                : amounts === undefined
                  ? undefined
                  : `You receive ${naira(amounts.sellerProceedsMinor)} when the trade completes.`
            }
          />
          {pickedCategory === '' && detected !== undefined ? (
            <NoteBanner>
              We detected the category:{' '}
              {standards.data.find((item) => item.categoryCode === detected)?.categoryName ?? detected}. Its
              specification and protections load automatically.
            </NoteBanner>
          ) : (
            <Select
              label="Category"
              value={category ?? ''}
              onChange={(event) => {
                setPickedCategory(event.target.value);
                setFields({});
              }}
              invalid={tried && category === undefined}
              helper={
                tried && category === undefined
                  ? 'Choose a category to carry on'
                  : "We couldn't tell the category from what you typed, so choose the closest one."
              }
              options={[
                { value: '', label: 'Choose a category' },
                ...standards.data.map((item) => ({ value: item.categoryCode, label: item.categoryName })),
              ]}
            />
          )}
          {!canSell && (
            <WarnBanner title="You can't sell on this account">
              This account isn&apos;t able to take the seller side of a trade.
            </WarnBanner>
          )}
        </>
      )}

      {stage === 1 && standard !== undefined && (
        <>
          <h2 className="m-0 text-[18px] font-semibold">Item &amp; delivery</h2>
          <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">
            Tell us what you&apos;re trading. The buyer chooses where it goes.
          </p>
          {pickedCategory !== '' && (
            <NoteBanner>
              Category: {standard.categoryName}. Its specification replaces the other category&apos;s fields.
            </NoteBanner>
          )}
          <ItemFields
            standard={standard}
            fields={fields}
            setField={(key, value) => {
              setFields((current) => ({ ...current, [key]: value }));
            }}
            tried={tried}
          />
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
          <AddressPicker label="Ships from" value={addressId} onChange={setAddressId} />
          <SectionLabel>Where it goes</SectionLabel>
          <NoteBanner>
            The buyer chooses courier or Park and gives their address or collection details after you send
            this.
          </NoteBanner>
          {tried && !itemOk && (
            <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
              {missingField !== undefined
                ? `Add the ${missingField.label.toLowerCase()} to carry on.`
                : !proofMet
                  ? 'Add the photos and video to carry on.'
                  : 'Choose where it ships from to carry on.'}
            </p>
          )}
        </>
      )}

      {stage === 2 && standard !== undefined && (
        <>
          <h2 className="m-0 text-[18px] font-semibold">Trade terms</h2>
          <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">
            Here&apos;s how delivery, inspection and protection will work.
          </p>
          <fieldset className="mb-[16px] min-w-0 border-0 p-0">
            <legend className="mb-[6px] p-0 text-[13px] font-semibold">How you&apos;ll deliver</legend>
            <OptionCard
              name="delivery-mode"
              value="COURIER"
              checked
              onChange={() => undefined}
              description="Delivered to the buyer's address"
            >
              Courier delivery
            </OptionCard>
            <OptionCard
              name="delivery-mode"
              value="PARK"
              checked={false}
              disabled={!parkEnabled}
              onChange={() => undefined}
              description={
                parkEnabled
                  ? 'Collect from a Komtru-supported Park'
                  : 'Coming soon. Courier delivery only for now.'
              }
            >
              Park delivery
            </OptionCard>
          </fieldset>
          <TextField
            label="Delivery partner"
            placeholder="The courier you will use"
            value={partner}
            onChange={(event) => {
              setPartner(event.target.value);
            }}
            invalid={tried && partner.trim() === ''}
          />
          <TextField
            label="Delivery charge (₦)"
            inputMode="decimal"
            placeholder="₦3,500"
            value={charge}
            onChange={(event) => {
              setCharge(event.target.value);
            }}
            invalid={tried && chargeMinor === undefined}
            helper={
              tried && chargeMinor === undefined
                ? 'Enter the delivery charge in naira, for example 3,500'
                : 'You set this. The buyer sees it before accepting.'
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
            {tried && promise === '' && (
              <p role="alert" className="text-[12px] font-semibold text-risk-on-soft">
                Choose when you will deliver.
              </p>
            )}
          </fieldset>
          <KomtruTerms standard={standard} />
          <NoteBanner>
            You can&apos;t change Komtru&apos;s protection terms. They&apos;re what keeps the Trade protected
            for both sides.
          </NoteBanner>
        </>
      )}

      {stage === 3 && standard !== undefined && kobo !== undefined && reviewSpec !== undefined && (
        <>
          <ItemCard
            title={itemTitle(reviewSpec, title.trim())}
            {...(itemSub(reviewSpec) === undefined ? {} : { sub: itemSub(reviewSpec) })}
            price={naira(kobo.toString())}
          />
          <Agreement
            sellerName={buyerName}
            partyLabel="Buyer"
            sellerLocation={
              shipsFrom === undefined ? undefined : `${shipsFrom.streetLine}, ${shipsFrom.cityName}`
            }
            itemDetails={itemSub(reviewSpec) ?? 'Confirmed by you'}
            deliveryLine={
              <>
                Courier · the buyer gives the address{' '}
                <span className="font-semibold text-warning-on-soft">Waiting</span>
              </>
            }
            deliveryChargeMinor={(chargeMinor ?? 0n).toString()}
            deliveryPromise={promise}
            inspectionHours={standard.inspectionWindowHours}
            categoryName={standard.categoryName}
            fees={
              amounts === undefined
                ? undefined
                : {
                    itemMinor: amounts.itemMinor,
                    protectionFeeMinor: amounts.buyerProtectionFeeMinor,
                    totalMinor: amounts.buyerTotalMinor,
                    proceedsMinor: amounts.sellerProceedsMinor,
                  }
            }
            totalNote="The delivery charge is paid to the seller outside Komtru protection and is not part of this total."
          />
          <NoteBanner title="Before you send">
            These terms become the shared reference point for this Trade. The buyer must accept before funds
            can be protected.
          </NoteBanner>
        </>
      )}

      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack>
        {stage < 3 ? (
          <>
            <Button
              type="button"
              onClick={() => void next()}
              disabled={busy || (stage === 0 && (merchantBuyer || cannotInvite))}
            >
              {stage === 2 ? 'Review' : 'Continue'}
            </Button>
            {stage === 1 && fashion !== undefined && standard?.categoryCode !== 'fashion' && (
              <Button
                type="button"
                variant="ghost"
                className="self-center"
                onClick={() => {
                  setPickedCategory('fashion');
                  setFields({});
                }}
              >
                This is a {fashion.categoryName} item
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Sending…' : 'Send to buyer'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStage(2);
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
