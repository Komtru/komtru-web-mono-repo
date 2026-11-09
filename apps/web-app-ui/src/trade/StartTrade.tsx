'use client';

import {
  classifyParty,
  lookupParty,
  type LookupResult,
  type TradeRole,
  type TradeView,
} from '@komtru/api-client';
import {
  useApiClient,
  useCancelTrade,
  useCreateTrade,
  usePreviewTrade,
  useSendTrade,
  useTradeStandards,
} from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
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
import { nairaToKobo } from '@komtru/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AddressPicker } from './AddressPicker';
import { initialsOf, naira, problemMessage } from './format';
import { ProofUpload } from './ProofUpload';

export interface StartTradeProps {
  /** Buy mode starts a purchase and Sell mode a sale; the person can still switch here. */
  defaultRole?: TradeRole;
  /** A handle, email or phone to name as the other party, from a link such as a seller's passport. */
  counterparty?: string;
}

type Looked = { value: string; result: LookupResult };

/** `nairaToKobo`, or `undefined` for anything that is not a positive amount. */
function parseAmount(text: string): bigint | undefined {
  try {
    const kobo = nairaToKobo(text);
    return kobo > 0n ? kobo : undefined;
  } catch {
    return undefined;
  }
}

/**
 * I3, built on what the platform has. The drawing starts from a listing; listings are not in the
 * platform yet, so the item is described here against the category's Trade Standard, which is also
 * what the platform checks it against when the proposal is created.
 *
 * Two calls make a proposal: create the draft, then send it to the other party. The draft's id is kept
 * once it exists, so a send that fails (offline, a lookup that needs a second look) is retried on the
 * same draft rather than creating a second trade.
 */
export function StartTrade({ defaultRole = 'BUYER', counterparty = '' }: StartTradeProps): React.JSX.Element {
  const router = useRouter();
  const client = useApiClient();
  const standards = useTradeStandards();
  const preview = usePreviewTrade();
  const create = useCreateTrade();
  const send = useSendTrade();
  const cancel = useCancelTrade();

  const [categoryCode, setCategoryCode] = useState('');
  const [chosenRole, setChosenRole] = useState<TradeRole>(defaultRole);
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [proof, setProof] = useState<string[]>([]);
  const [who, setWho] = useState(counterparty);
  const [looked, setLooked] = useState<Looked | undefined>(undefined);
  // The draft this form has already created, and the exact inputs it was created from.
  const [draft, setDraft] = useState<{ id: string; inputs: string } | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const standard = standards.data?.find(
    (item) => item.categoryCode === (categoryCode || standards.data?.[0]?.categoryCode),
  );
  const category = standard?.categoryCode ?? '';
  const kobo = parseAmount(amount);

  // The platform says which sides this person may take (a certified merchant sells only) and what the
  // fees come to. Asked again when the category, side or price changes; stored nowhere.
  const { mutate: runPreview } = preview;
  useEffect(() => {
    if (category === '') return;
    runPreview({
      role: chosenRole,
      categoryCode: category,
      ...(kobo === undefined ? {} : { itemAmountMinor: kobo.toString() }),
    });
  }, [category, chosenRole, kobo, runPreview]);

  const allowed = preview.data?.allowedRoles ?? ['BUYER', 'SELLER'];
  const role: TradeRole = allowed.includes(chosenRole) ? chosenRole : (allowed[0] ?? chosenRole);
  const amounts = preview.data?.fees[0]?.snapshot.amounts;

  const party = useMemo(() => classifyParty(who), [who]);
  const lookedNow =
    looked !== undefined && party !== undefined && looked.value === party.value ? looked.result : undefined;

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

  const specMissing = (standard?.itemSpecFields ?? []).filter(
    (field) => field.required && (spec[field.key] ?? '').trim() === '',
  );
  const proofNeeded = role === 'SELLER' ? (standard?.proofMedia.minPhotos ?? 0) : 0;
  const invalid =
    standard === undefined ||
    specMissing.length > 0 ||
    kobo === undefined ||
    addressId === null ||
    party === undefined ||
    proof.length < proofNeeded;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    setProblem(undefined);
    if (invalid || standard === undefined || kobo === undefined || addressId === null || party === undefined)
      return;

    const found = await check();
    if (found === undefined) return;
    if (found.found && role === 'SELLER' && !found.party.canBuy) return;
    if (!found.found && !found.canInvite) return;

    setBusy(true);
    try {
      const itemSpec: Record<string, string> = {};
      for (const [key, value] of Object.entries(spec)) {
        if (value.trim() !== '') itemSpec[key] = value.trim();
      }
      const proofFileIds = role === 'SELLER' && proof.length > 0 ? proof : undefined;
      // A draft is its inputs. One made from different ones (the person changed the price, the
      // category, the side or the address after a send failed) is not sent: it is withdrawn and a new
      // one is made from what is on screen, so a retry never proposes terms the person has since edited.
      const inputs = JSON.stringify([
        role,
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
          // Best effort: an orphan that cannot be cancelled is never shown to anyone, only unsent.
          await cancel.mutateAsync({ id: draft.id }).catch(() => undefined);
        }
        const created = await create.mutateAsync({
          role,
          categoryCode: standard.categoryCode,
          itemAmountMinor: kobo.toString(),
          itemSpec,
          addressId,
          ...(proofFileIds === undefined ? {} : { proofFileIds }),
        });
        id = created.id;
        setDraft({ id, inputs });
      }
      const sent: TradeView = await send.mutateAsync({
        id,
        ...(party.channel === 'USERNAME'
          ? { username: party.value }
          : party.channel === 'EMAIL'
            ? { email: party.value }
            : { phone: party.value }),
        ...(role === 'SELLER' && proof.length > 0 ? { proofFileIds: proof } : {}),
      });
      router.push(`/trade/${sent.id}`);
    } catch (error) {
      setProblem(problemMessage(error, "We couldn't send that request. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };

  if (standards.isPending) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Start Trade" backHref="/trades" />
        <LoadingScreen label="Loading the categories" />
      </ScreenColumn>
    );
  }
  if (standards.isError || standard === undefined) {
    return (
      <ScreenColumn>
        <ScreenHeader title="Start Trade" backHref="/trades" />
        <LoadFailed
          title="Couldn't load the categories"
          body="Check your connection and try again."
          onRetry={() => void standards.refetch()}
        />
      </ScreenColumn>
    );
  }

  const merchantBuyer = lookedNow?.found === true && role === 'SELLER' && !lookedNow.party.canBuy;
  const cannotInvite = lookedNow?.found === false && !lookedNow.canInvite;

  return (
    <ScreenColumn>
      <ScreenHeader title="Start Trade" backHref="/trades" />
      <form onSubmit={(event) => void submit(event)} noValidate>
        {allowed.length > 1 && (
          <fieldset className="mb-[16px] min-w-0 border-0 p-0">
            <legend className="mb-[6px] p-0 text-[13px] font-semibold">What are you doing?</legend>
            {(['BUYER', 'SELLER'] as const).map((option) => (
              <OptionCard
                key={option}
                name="trade-role"
                value={option}
                checked={role === option}
                onChange={(changed) => {
                  setChosenRole(changed.target.value as TradeRole);
                }}
              >
                {option === 'BUYER' ? "I'm buying" : "I'm selling"}
              </OptionCard>
            ))}
          </fieldset>
        )}

        <Select
          label="Category"
          value={category}
          onChange={(changed) => {
            setCategoryCode(changed.target.value);
            setSpec({});
          }}
          helper={
            <a href="/trade/standards" className="font-semibold text-trust-indigo">
              See the Trade Standards for every category
            </a>
          }
          options={standards.data.map((item) => ({ value: item.categoryCode, label: item.categoryName }))}
        />

        <SectionLabel>About the item</SectionLabel>
        {standard.itemSpecFields.map((field) => (
          <TextField
            key={field.key}
            label={field.required ? field.label : `${field.label} (optional)`}
            value={spec[field.key] ?? ''}
            onChange={(changed) => {
              setSpec((current) => ({ ...current, [field.key]: changed.target.value }));
            }}
            invalid={tried && field.required && (spec[field.key] ?? '').trim() === ''}
          />
        ))}
        <TextField
          label="Price"
          inputMode="decimal"
          placeholder="₦452,000"
          value={amount}
          onChange={(changed) => {
            setAmount(changed.target.value);
          }}
          invalid={tried && kobo === undefined}
          helper={
            tried && kobo === undefined
              ? 'Enter the price in naira, for example 452,000'
              : amounts === undefined
                ? undefined
                : role === 'BUYER'
                  ? `The buyer pays ${naira(amounts.buyerTotalMinor)} including the ${naira(amounts.buyerProtectionFeeMinor)} protection fee.`
                  : `You receive ${naira(amounts.sellerProceedsMinor)} when the trade completes.`
          }
        />

        <AddressPicker
          label={role === 'BUYER' ? 'Delivery address' : 'Ships from'}
          value={addressId}
          onChange={setAddressId}
        />

        {role === 'SELLER' && (
          <>
            <SectionLabel>Proof of the item</SectionLabel>
            <ProofUpload required={proofNeeded} onChange={setProof} step="send" />
          </>
        )}

        <SectionLabel>Who is it with?</SectionLabel>
        <TextField
          label={role === 'BUYER' ? 'The seller' : 'The buyer'}
          autoComplete="off"
          placeholder="@username, email or phone"
          value={who}
          onChange={(changed) => {
            setWho(changed.target.value);
            setProblem(undefined);
          }}
          onBlur={() => void check()}
          invalid={tried && party === undefined}
          helper={
            tried && party === undefined ? 'Enter their @username, email address or phone number' : undefined
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
              lookedNow.party.displayName ?? lookedNow.party.merchantName ?? lookedNow.party.username ?? 'K',
            )}
            meta={`${String(lookedNow.party.completedTrades)} completed trade${lookedNow.party.completedTrades === 1 ? '' : 's'}`}
          />
        )}
        {merchantBuyer && (
          <WarnBanner title="They can't be the buyer">
            This is a certified merchant. Merchants sell on Komtru; they don&apos;t buy. Switch to buying, or
            name someone else.
          </WarnBanner>
        )}
        {lookedNow?.found === false && lookedNow.canInvite && (
          <NoteBanner>
            If they&apos;re on Komtru, this reaches them. If not, they&apos;re invited to join, and the
            request is waiting for them when they sign up with this{' '}
            {party?.channel === 'EMAIL' ? 'email' : 'phone number'}.
          </NoteBanner>
        )}
        {cannotInvite && (
          <WarnBanner title="We can't find that username">
            Check the spelling, or use their phone number or email so we can invite them.
          </WarnBanner>
        )}

        {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
        {tried && invalid && problem === undefined && (
          <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
            {specMissing.length > 0
              ? `Add the ${specMissing[0]?.label.toLowerCase() ?? 'item details'} to carry on.`
              : kobo === undefined
                ? 'Enter the price to carry on.'
                : addressId === null
                  ? 'Choose an address to carry on.'
                  : proof.length < proofNeeded
                    ? 'Add proof of the item to carry on.'
                    : 'Say who the trade is with to carry on.'}
          </p>
        )}
        <ActionStack>
          <Button type="submit" disabled={busy || merchantBuyer || cannotInvite}>
            {busy ? 'Sending…' : 'Send Trade request'}
          </Button>
        </ActionStack>
      </form>
    </ScreenColumn>
  );
}
