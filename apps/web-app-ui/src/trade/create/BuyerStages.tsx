'use client';

import type { LookupResult, TradeStandard, TradeView } from '@komtru/api-client';
import {
  ActionStack,
  CodeCard,
  NoteBanner,
  OptionCard,
  PartyStrip,
  ScreenColumn,
  SectionLabel,
  Select,
  StatusHero,
  TermList,
  TermRow,
  TextField,
  VersionTimeline,
  WarnBanner,
} from '@komtru/ui-kit';
import { useState } from 'react';
import { AddressPicker } from '../AddressPicker';
import { hoursLabel, initialsOf } from '../format';
import { BACK_TO_TRADES } from '../parts';
import type { DeliveryMode, ParkOption } from './request';

/** CT-B1: who, what, how much. The category is detected, and only asked when nothing could be detected. */
export function About(props: {
  who: string;
  setWho: (value: string) => void;
  onCheck: () => void;
  party: boolean;
  lookedNow: LookupResult | undefined;
  cannotInvite: boolean;
  title: string;
  setTitle: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  kobo: bigint | undefined;
  tried: boolean;
  standards: readonly TradeStandard[];
  detected: string | undefined;
  category: string | undefined;
  setCategory: (value: string) => void;
  canBuy: boolean;
  feeNote: string | undefined;
}): React.JSX.Element {
  const { lookedNow, tried } = props;
  const detectedStandard = props.standards.find((item) => item.categoryCode === props.detected);
  return (
    <>
      <h2 className="m-0 text-[18px] font-semibold">Tell us what you&apos;re buying</h2>
      <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">We&apos;ll help you fill in the rest.</p>
      <TextField
        label="Who's the seller?"
        autoComplete="off"
        placeholder="@username, email or phone"
        value={props.who}
        onChange={(event) => {
          props.setWho(event.target.value);
        }}
        onBlur={props.onCheck}
        invalid={tried && !props.party}
        helper={tried && !props.party ? 'Enter their @username, email address or phone number' : undefined}
      />
      {lookedNow?.found === true && (
        <PartyStrip
          name={
            lookedNow.party.merchantName ??
            lookedNow.party.displayName ??
            `@${lookedNow.party.username ?? 'member'}`
          }
          initials={initialsOf(
            lookedNow.party.merchantName ?? lookedNow.party.displayName ?? lookedNow.party.username ?? 'K',
          )}
          meta={`Profile found · ${String(lookedNow.party.completedTrades)} completed trade${lookedNow.party.completedTrades === 1 ? '' : 's'}`}
        />
      )}
      {lookedNow?.found === false && lookedNow.canInvite && (
        <NoteBanner>
          They aren&apos;t on Komtru that we can see. They&apos;re invited to join, and the request waits for
          them when they sign up with this phone number or email.
        </NoteBanner>
      )}
      {props.cannotInvite && (
        <WarnBanner title="We can't find that username">
          Check the spelling, or use their phone number or email so we can invite them.
        </WarnBanner>
      )}
      <TextField
        label="What are you buying?"
        placeholder="iPhone 13 Pro 256GB"
        value={props.title}
        onChange={(event) => {
          props.setTitle(event.target.value);
        }}
        invalid={tried && props.title.trim() === ''}
        helper={tried && props.title.trim() === '' ? 'Say what you are buying' : undefined}
      />
      <TextField
        label="Agreed price"
        inputMode="decimal"
        placeholder="₦452,000"
        value={props.amount}
        onChange={(event) => {
          props.setAmount(event.target.value);
        }}
        invalid={tried && props.kobo === undefined}
        helper={
          tried && props.kobo === undefined ? 'Enter the price in naira, for example 452,000' : props.feeNote
        }
      />
      {detectedStandard !== undefined ? (
        <NoteBanner>
          We detected the category: {detectedStandard.categoryName}. Its item details, inspection window and
          protections load automatically — you don&apos;t need to pick anything.
        </NoteBanner>
      ) : (
        <Select
          label="Category"
          value={props.category ?? ''}
          onChange={(event) => {
            props.setCategory(event.target.value);
          }}
          invalid={tried && props.category === undefined}
          helper={
            tried && props.category === undefined
              ? 'Choose a category to carry on'
              : "We couldn't tell the category from what you typed, so choose the closest one."
          }
          options={[
            { value: '', label: 'Choose a category' },
            ...props.standards.map((item) => ({ value: item.categoryCode, label: item.categoryName })),
          ]}
        />
      )}
      {!props.canBuy && (
        <WarnBanner title="Merchants sell on Komtru">
          Your account is a certified merchant account. Merchants sell; they don&apos;t buy.
        </WarnBanner>
      )}
    </>
  );
}

/** CT-B2 and CT-B2P: what the seller will confirm, and how the item should reach the buyer. */
export function ItemAndDelivery(props: {
  standard: TradeStandard;
  title: string;
  mode: DeliveryMode;
  setMode: (mode: DeliveryMode) => void;
  addressId: string | null;
  setAddressId: (id: string | null) => void;
  parkEnabled: boolean;
  parks: readonly ParkOption[];
  parkId: string;
  setParkId: (id: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  phoneOk: boolean;
  tried: boolean;
}): React.JSX.Element {
  const required = props.standard.itemSpecFields.filter((field) => field.required);
  return (
    <>
      <h2 className="m-0 text-[18px] font-semibold">Item &amp; delivery</h2>
      <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">
        Tell us what you&apos;re trading and where it should go.
      </p>
      <SectionLabel>Item details</SectionLabel>
      <NoteBanner>
        The seller will confirm the item details. Some details can only be confirmed by the seller —
        they&apos;ll complete these before the Trade can be accepted.
      </NoteBanner>
      <TermList aria-label="Item details">
        <TermRow label="Item">{props.title.trim()} (from you)</TermRow>
        {required.map((field) => (
          <TermRow key={field.key} label={field.label}>
            <span className="font-semibold text-info-on-soft">Seller provides</span>
          </TermRow>
        ))}
      </TermList>

      <fieldset className="mb-[16px] mt-[16px] min-w-0 border-0 p-0">
        <legend className="mb-[6px] p-0 text-[13px] font-semibold">How should this item get to you?</legend>
        <OptionCard
          name="delivery-mode"
          value="COURIER"
          checked={props.mode === 'COURIER'}
          onChange={() => {
            props.setMode('COURIER');
          }}
          description="Delivered to your address"
        >
          Courier
        </OptionCard>
        <OptionCard
          name="delivery-mode"
          value="PARK"
          checked={props.mode === 'PARK'}
          disabled={!props.parkEnabled}
          onChange={() => {
            props.setMode('PARK');
          }}
          description={
            props.parkEnabled
              ? 'Collect from a Komtru-supported Park'
              : 'Coming soon. Courier delivery only for now.'
          }
        >
          Park
        </OptionCard>
      </fieldset>

      {props.mode === 'COURIER' ? (
        <AddressPicker
          label="Where should we deliver it?"
          value={props.addressId}
          onChange={props.setAddressId}
        />
      ) : (
        <>
          <fieldset className="mb-[16px] min-w-0 border-0 p-0">
            <legend className="mb-[6px] p-0 text-[13px] font-semibold">Choose a Park</legend>
            {props.parks.length === 0 && (
              <p className="text-[12px] text-slate">No Parks are available to collect from yet.</p>
            )}
            {props.parks.map((park) => (
              <OptionCard
                key={park.id}
                name="park"
                value={park.id}
                checked={props.parkId === park.id}
                onChange={() => {
                  props.setParkId(park.id);
                }}
                description={park.detail}
              >
                {park.name}
              </OptionCard>
            ))}
            {props.tried && props.parkId === '' && (
              <p role="alert" className="text-[12px] font-semibold text-risk-on-soft">
                Choose a Park to carry on.
              </p>
            )}
          </fieldset>
          <SectionLabel>Collection details</SectionLabel>
          <TextField
            label="Phone"
            inputMode="tel"
            value={props.phone}
            onChange={(event) => {
              props.setPhone(event.target.value);
            }}
            invalid={props.tried && !props.phoneOk}
            helper={
              props.tried && !props.phoneOk
                ? 'Enter a phone number the Park can reach you on'
                : 'The Park contacts you on this number when your item arrives.'
            }
          />
          <AddressPicker label="Your address on file" value={props.addressId} onChange={props.setAddressId} />
        </>
      )}
      {props.tried && props.addressId === null && (
        <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
          Choose an address to carry on.
        </p>
      )}
    </>
  );
}

/** What Komtru sets for the category, the same for every Trade. Shown, never edited, on CT-B3 and CT-S3. */
export function KomtruTerms({ standard }: { standard: TradeStandard }): React.JSX.Element {
  return (
    <>
      <SectionLabel>Set by Komtru — the same for every Trade</SectionLabel>
      <TermList aria-label="Set by Komtru">
        <TermRow label="Inspection">
          {hoursLabel(standard.inspectionWindowHours)} · {standard.categoryName}{' '}
          <span className="font-semibold text-info-on-soft">Komtru policy</span>
        </TermRow>
        <TermRow label="Buyer can ask for">More time, with a reason, up to the limit Komtru sets</TermRow>
        <TermRow label="Cancellation">Free before shipment</TermRow>
        <TermRow label="Refund">Full refund if damaged, not as described or incomplete</TermRow>
        <TermRow label="Returns">Per the {standard.categoryName} policy</TermRow>
      </TermList>
    </>
  );
}

/** CT-B3: protection is Komtru's and is only shown; the delivery commitments are the seller's. */
export function Terms({ standard }: { standard: TradeStandard }): React.JSX.Element {
  return (
    <>
      <h2 className="m-0 text-[18px] font-semibold">Trade terms</h2>
      <p className="mb-[16px] mt-[4px] text-[12.5px] text-slate">
        Here&apos;s how delivery, inspection and protection will work.
      </p>
      <KomtruTerms standard={standard} />
      <SectionLabel>The seller will add</SectionLabel>
      <TermList aria-label="The seller will add">
        <TermRow label="Delivery cost">
          <span className="font-semibold text-info-on-soft">Seller provides</span>
        </TermRow>
        <TermRow label="Delivery promise">
          <span className="font-semibold text-info-on-soft">Seller provides</span>
        </TermRow>
      </TermList>
      <NoteBanner>
        You can&apos;t change Komtru&apos;s protection terms — they&apos;re what keeps the Trade protected for
        both sides. Need longer to inspect? You can ask for more time after delivery.
      </NoteBanner>
    </>
  );
}

const CODE_ACTION =
  'flex-1 cursor-pointer rounded-[10px] px-[14px] py-[11px] text-[13px] font-semibold focus-visible:outline-[2.5px] focus-visible:outline-pure-white focus-visible:outline-offset-[2px]';

/** CT-B5: the request is with the seller, and the screen says what is outstanding. */
export function Sent({
  trade,
  sellerName,
  role = 'BUYER',
}: {
  trade: TradeView;
  /** The other party's name, whichever side that is. */
  sellerName: string;
  /** Whose screen this is: the buyer who asked (CT-B5) or the seller who offered (CT-S5). */
  role?: 'BUYER' | 'SELLER';
}): React.JSX.Element {
  const selling = role === 'SELLER';
  const [shared, setShared] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setShared('copied');
      },
      () => {
        setShared('failed');
      },
    );
  };
  const share = () => {
    if (typeof navigator.share === 'function') {
      navigator
        .share({ title: 'Komtru Trade', text: `Trade Code ${trade.tradeCode}`, url: trade.shareUrl })
        .catch(() => undefined);
    } else {
      copy(trade.shareUrl);
    }
  };
  return (
    <ScreenColumn>
      <StatusHero tone="success" title={`Sent to ${sellerName}`}>
        {selling
          ? "They'll choose how to receive it, give their delivery address and review the final cost. You'll be notified when they respond."
          : "They'll confirm the item details and delivery cost, then you'll review and accept. Nothing is charged until then."}
      </StatusHero>
      <CodeCard label="Your Trade Code" code={trade.tradeCode}>
        <button
          type="button"
          onClick={() => {
            copy(trade.tradeCode);
          }}
          className={`${CODE_ACTION} border border-solid border-[rgba(255,255,255,.35)] bg-transparent text-pure-white`}
        >
          Copy
        </button>
        <button
          type="button"
          onClick={share}
          className={`${CODE_ACTION} border-0 bg-pure-white text-komtru-midnight`}
        >
          Share
        </button>
      </CodeCard>
      <p role="status" className="mb-[12px] mt-0 text-[11.5px] text-slate">
        {shared === 'copied'
          ? 'Copied.'
          : shared === 'failed'
            ? `Couldn't copy it. The code is ${trade.tradeCode}.`
            : ''}
      </p>
      <SectionLabel>What happens next</SectionLabel>
      <VersionTimeline
        aria-label="What happens next"
        className="mb-[16px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px]"
        steps={
          selling
            ? [
                {
                  id: 'told',
                  title: "You've described the item",
                  detail: 'Specification, photos and delivery terms',
                  state: 'done',
                },
                {
                  id: 'buyer',
                  title: `${sellerName} chooses how to receive it`,
                  detail: 'Their delivery address',
                  state: 'active',
                },
                {
                  id: 'accept',
                  title: `${sellerName} reviews and accepts`,
                  detail: 'With the final cost',
                  state: 'pending',
                },
                { id: 'fund', title: 'Payment is protected', detail: 'Then you dispatch', state: 'pending' },
              ]
            : [
                {
                  id: 'told',
                  title: "You've told us what you want",
                  detail: 'Seller, item, price and where it goes',
                  state: 'done',
                },
                {
                  id: 'seller',
                  title: `${sellerName} adds their part`,
                  detail: 'Item details, delivery cost and promise',
                  state: 'active',
                },
                {
                  id: 'accept',
                  title: 'You review and accept',
                  detail: 'With the final cost visible',
                  state: 'pending',
                },
                { id: 'fund', title: 'You fund the Trade', detail: 'Payment is protected', state: 'pending' },
              ]
        }
      />
      <ActionStack>{BACK_TO_TRADES}</ActionStack>
    </ScreenColumn>
  );
}
