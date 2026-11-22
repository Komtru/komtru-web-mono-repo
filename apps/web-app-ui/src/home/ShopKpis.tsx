'use client';

import { usePayoutSummary } from '@komtru/api-client/react';
import { NoteBanner } from '@komtru/ui-kit';
import { MERCHANT_STATUS_HREF } from '../trade/create/sellLimit';
import { nairaShort } from '../trade/format';
import { useAllTrades } from './useAllTrades';

/** Order statuses the seller acts on next (ship it), and the ones where the item is with the courier or the buyer. */
const TO_SHIP: readonly string[] = ['FUNDED'];
const WITH_BUYER: readonly string[] = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION'];

/**
 * DX-04's shop KPI strip (F-083), with what the platform can report today: the payout balance as the payouts
 * module reads it, and how many of the person's sales are waiting to be shipped or are with the buyer. The
 * reference's "In escrow" and "Returns inbound" are left out: the platform reports neither, and a money total is
 * never summed in the browser. The counts are of the trades the list has loaded, so they read "…" until it has all.
 */
export function ShopKpis({ certifiedMerchant }: { certifiedMerchant: boolean }): React.JSX.Element {
  const summary = usePayoutSummary();
  const all = useAllTrades();
  const sales = all.trades.filter((trade) => trade.yourRole === 'SELLER');
  const count = (statuses: readonly string[]): string =>
    all.complete
      ? String(sales.filter((trade) => statuses.includes(trade.status)).length)
      : all.nextPageFailed || all.isError
        ? '—'
        : '…';

  return (
    <div className="mb-[12px]">
      <ul
        aria-label="Your shop at a glance"
        className="m-0 mb-[10px] grid list-none grid-cols-2 gap-[8px] p-0 sm:grid-cols-3"
      >
        <Kpi
          wide
          label="Available"
          value={
            summary.data !== undefined ? nairaShort(summary.data.availableMinor) : summary.isError ? '—' : '…'
          }
          note="Ready to withdraw"
          href="/account/payouts"
        />
        <Kpi label="To ship" value={count(TO_SHIP)} note="Buyer has paid" href="/orders" />
        <Kpi
          label="With the buyer"
          value={count(WITH_BUYER)}
          note="In transit or inspection"
          href="/orders"
        />
      </ul>
      {!certifiedMerchant && (
        <NoteBanner>
          You&apos;re selling without merchant status, so there&apos;s a limit on each trade and on each day.{' '}
          <a className="font-semibold text-trust-indigo" href={MERCHANT_STATUS_HREF}>
            Get merchant status
          </a>{' '}
          to sell more.
        </NoteBanner>
      )}
    </div>
  );
}

function Kpi({
  wide = false,
  label,
  value,
  note,
  href,
}: {
  /** Takes the whole row on a phone, where a naira balance does not fit a third of 340px. */
  wide?: boolean;
  label: string;
  value: string;
  note: string;
  href: string;
}): React.JSX.Element {
  return (
    <li className={wide ? 'col-span-2 sm:col-span-1' : undefined}>
      <a
        href={href}
        className="block rounded-md border border-solid border-border-hairline bg-surface-primary p-[10px] hover:border-trust-indigo focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo"
      >
        <span className="block text-[11px] text-slate">{label}</span>
        <span className="mt-[2px] block font-display text-[17px] font-semibold text-midnight-text">
          {value}
        </span>
        <span className="mt-[2px] block text-[10.5px] text-slate">{note}</span>
      </a>
    </li>
  );
}
