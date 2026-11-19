'use client';

import { useId, useState } from 'react';
import styles from './FeeCalculator.module.css';

/**
 * The pricing page's fee calculator.
 *
 * It is the only interactive thing on the marketing site that quotes money, so it is the only
 * place a wrong number here becomes a promise Komtru has to keep. Two rules follow from that: the
 * rate is cited, not remembered, and the arithmetic is done in kobo.
 */

/**
 * The Buyer Protection Fee, in basis points.
 *
 * SOURCE OF TRUTH: `config/fees.yaml` → `buyer_protection_fee.rate_bps: 150` (1.5%, `min_minor: 0`,
 * `max_minor: null` — so no floor and no cap to apply here). Change that file and this constant
 * changes with it; a marketing page quoting a stale rate is how the two silently diverge.
 */
const FEE_RATE_BPS = 150;

const KOBO_PER_NAIRA = 100;
const BPS_PER_UNIT = 10_000;

/** The slider, in naira. The reference's own bounds. */
const MIN_PRICE = 10_000;
const MAX_PRICE = 2_000_000;
const PRICE_STEP = 5_000;
const DEFAULT_PRICE = 150_000;

/**
 * The fee on a price, both in kobo.
 *
 * Minor units throughout: `150_000 * 0.015` is exact, but most of this slider's 399 stops are not,
 * and a float total renders as ₦152,249.999 the first time one is not.
 */
export const feeMinor = (priceMinor: number): number =>
  Math.round((priceMinor * FEE_RATE_BPS) / BPS_PER_UNIT);

/** Kobo to the naira figure the reference shows — `₦152,250`, never `₦152,250.00`. */
export const formatNaira = (minor: number): string =>
  `₦${Math.round(minor / KOBO_PER_NAIRA).toLocaleString('en-NG')}`;

type Side = 'buyer' | 'seller';

interface BreakdownRow {
  readonly label: string;
  readonly value: string;
  /** The row the whole breakdown is for: the total, or what the seller receives. */
  readonly strong?: boolean;
}

/** What each side of the trade sees, which is not the same breakdown. */
function breakdown(side: Side, priceMinor: number): readonly BreakdownRow[] {
  const price = formatNaira(priceMinor);
  if (side === 'seller') {
    return [
      { label: 'Item price', value: price },
      { label: 'Seller fees', value: 'To be confirmed' },
      { label: 'You receive', value: `${price} before fees`, strong: true },
      { label: 'Paid', value: 'After buyer confirms' },
    ];
  }
  const fee = feeMinor(priceMinor);
  return [
    { label: 'Item price', value: price },
    { label: `Buyer Protection Fee (${FEE_RATE_BPS / 100}%)`, value: formatNaira(fee) },
    { label: 'Delivery', value: 'Set in agreement' },
    { label: 'Total you pay', value: formatNaira(priceMinor + fee), strong: true },
  ];
}

/**
 * Both columns of the band, not just the card.
 *
 * The reference puts the Buyer/Seller control in the left column, above the heading, and the card
 * it drives in the right one. They share state, so one client component spans the split rather
 * than two halves coordinating through the server component above them.
 */
export function FeeCalculator(): React.JSX.Element {
  const rangeId = useId();
  const [side, setSide] = useState<Side>('buyer');
  const [price, setPrice] = useState(DEFAULT_PRICE);

  const priceMinor = price * KOBO_PER_NAIRA;
  const rows = breakdown(side, priceMinor);

  return (
    <>
      <div>
        <div className={styles.seg} role="group" aria-label="Side">
          <button type="button" aria-pressed={side === 'buyer'} onClick={() => setSide('buyer')}>
            Buyer
          </button>
          <button type="button" aria-pressed={side === 'seller'} onClick={() => setSide('seller')}>
            Seller
          </button>
        </div>
        <h2>Fees, in plain sight.</h2>
        <p className="lede">Payment is released when the agreed completion conditions are met.</p>
      </div>

      <div className={styles.calc}>
        <label htmlFor={rangeId} className="note" style={{ margin: 0 }}>
          Item price
        </label>
        <output htmlFor={rangeId} className={styles.amt}>
          {formatNaira(priceMinor)}
        </output>
        <input
          id={rangeId}
          type="range"
          min={MIN_PRICE}
          max={MAX_PRICE}
          step={PRICE_STEP}
          value={price}
          // Without this a screen reader reads the raw "150000" as the slider moves.
          aria-valuetext={formatNaira(priceMinor)}
          onChange={(event) => setPrice(Number(event.target.value))}
        />

        {/*
          The live region, and the only one: the slider announces its own value through
          `aria-valuetext`, so a second region on the readout above would say every figure twice.
          `aria-atomic` re-reads the whole breakdown because the fee and the total are the point —
          the total alone does not say what it is made of.
        */}
        <div aria-live="polite" aria-atomic="true">
          {rows.map((row) => (
            <div className="tr2" key={row.label}>
              <span>{row.strong === true ? <b>{row.label}</b> : row.label}</span>
              <span>{row.strong === true ? <b>{row.value}</b> : row.value}</span>
            </div>
          ))}
        </div>

        <p className="note">1.5% Buyer Protection Fee is an example rate until fees are confirmed.</p>
      </div>
    </>
  );
}
