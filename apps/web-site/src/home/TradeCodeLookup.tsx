'use client';

import { useId, useState } from 'react';
import { WhatsAppIcon } from '../art/Icons';

/**
 * The Trade Code box.
 *
 * It looks up one code — the example the page names — and says so. The point of the band is not
 * the search; it is the habit: you open Komtru yourself and type the code, rather than tapping a
 * link someone sent you. A box that only answers for `KMT-482731` teaches that in one try, and a
 * box wired to the real lookup would need a session the visitor does not have.
 *
 * The miss is written to be reassuring rather than alarming: a mistyped digit is the common case,
 * and "nothing has been charged" is the thing a worried person needs to read first.
 */

const EXAMPLE_CODE = 'KMT-482731';

const WHATSAPP_MESSAGE = (code: string): string =>
  `Your Trade is ready. Search ${code} on Komtru. Open Komtru yourself and look it up; don’t tap links from strangers.`;

const shareHref = (code: string): string =>
  `https://wa.me/?text=${encodeURIComponent(WHATSAPP_MESSAGE(code))}`;

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="tr2">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function TradeCodeLookup(): React.JSX.Element {
  const inputId = useId();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<'found' | 'missing' | null>(null);

  return (
    <>
      <form
        className="cf tcf"
        onSubmit={(event) => {
          event.preventDefault();
          setResult(code.trim().toUpperCase() === EXAMPLE_CODE ? 'found' : 'missing');
        }}
      >
        <input
          id={inputId}
          aria-label="Trade Code"
          placeholder={EXAMPLE_CODE}
          autoComplete="off"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button className="btn bp" type="submit">
          Check
        </button>
      </form>

      <p className="note">
        Try the example code <b style={{ fontFamily: 'var(--font-mono)' }}>{EXAMPLE_CODE}</b>.
      </p>

      <div className="tlk" aria-live="polite">
        {result === 'found' ? (
          <div className="lk2">
            <b>iPhone 13 Pro, 256GB · ₦452,000</b>
            <Row label="Seller" value="TechEdge NG · ID verified" />
            <Row label="Delivery" value="2–4 days, Lagos mainland" />
            <Row label="Inspection" value="48 hours" />
            <Row label="Status" value="Awaiting acceptance" />
            <p className="note">Example trade for the lookup.</p>
            <a className="btn bs wa wab" target="_blank" rel="noopener" href={shareHref(EXAMPLE_CODE)}>
              <WhatsAppIcon />
              Share this code on WhatsApp
            </a>
          </div>
        ) : null}
        {result === 'missing' ? (
          <div className="lk2">
            We couldn’t find that code. Check the digits with your seller. Nothing has been charged.
          </div>
        ) : null}
      </div>
    </>
  );
}
