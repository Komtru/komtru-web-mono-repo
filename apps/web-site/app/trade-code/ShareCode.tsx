'use client';

import { useId, useState } from 'react';
import { WhatsAppIcon } from '../../src/art/Icons';
import { whatsappShareHref } from '../../src/home/TradeCodeLookup';
import styles from './trade-code.module.css';

/**
 * The share box: you send the code, the other side looks it up themselves.
 *
 * It is the mirror of the lookup at the top of the page, and the reason both are here: a seller
 * who sends a link teaches a buyer to tap links, which is the habit this whole page exists to
 * break. So the thing this box produces is a sentence carrying a code and an instruction to
 * search it — never a URL into a trade.
 *
 * The sentence itself comes from `src/home/TradeCodeLookup.tsx`, which sends the same one from
 * its own share button. It is imported rather than repeated: it is the anti-phishing instruction,
 * and two copies of a safety message are two things that can drift until only one still says the
 * safe thing.
 */

const EXAMPLE_CODE = 'KMT-482731';

export function ShareCode(): React.JSX.Element {
  const inputId = useId();
  const [code, setCode] = useState(EXAMPLE_CODE);
  const trimmed = code.trim().toUpperCase();

  return (
    <div className={styles.calc}>
      {/* The first label in the card; `label.l` carries a top margin meant for the ones below it. */}
      <label className="l" htmlFor={inputId} style={{ marginTop: 0 }}>
        Your Trade Code
      </label>
      <input
        className="fld"
        id={inputId}
        value={code}
        autoComplete="off"
        style={{ fontFamily: 'var(--font-mono)' }}
        onChange={(event) => {
          setCode(event.target.value);
        }}
      />
      <div className="row">
        {/*
          Emptied, the reference still built a share link, falling back to the bare prefix "KMT-" —
          a message telling someone to search nothing. Nothing to share, nothing to press.
        */}
        {trimmed === '' ? (
          <button className="btn bp wa" type="button" disabled>
            <WhatsAppIcon />
            Share on WhatsApp
          </button>
        ) : (
          <a className="btn bp wa" href={whatsappShareHref(trimmed)} target="_blank" rel="noopener">
            <WhatsAppIcon />
            Share on WhatsApp
          </a>
        )}
      </div>
      <p className="note">Opens WhatsApp with the message ready. You choose who gets it.</p>
    </div>
  );
}
