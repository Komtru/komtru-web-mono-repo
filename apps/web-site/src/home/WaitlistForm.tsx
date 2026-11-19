'use client';

import { useId, useState } from 'react';
import { WhatsAppIcon } from '../art/Icons';
import { siteUrl } from '../site/config';
import {
  isContact,
  joinWaitlist,
  WAITLIST_CITIES,
  WAITLIST_INTENTS,
  type WaitlistIntent,
} from '../site/waitlist';

const INTENT_LABELS: Record<WaitlistIntent, string> = { BUY: 'Buy', SELL: 'Sell', BOTH: 'Both' };

const inviteHref = (): string =>
  `https://wa.me/?text=${encodeURIComponent(
    `I’m joining the Komtru waitlist. It protects the payment until your item arrives. Join: ${siteUrl()}/waitlist`,
  )}`;

/**
 * The waitlist card.
 *
 * Three states in one component — the form, the loader, and the confirmation — because they
 * replace each other in the same box and the reference animates the swap. The loader is the
 * brand's three pulsing nodes rather than a spinner.
 *
 * The confirmation names the city back. Someone who picked the wrong one notices there, which is
 * the last moment it is cheap to fix.
 */
export function WaitlistForm(): React.JSX.Element {
  const ids = { name: useId(), contact: useId(), city: useId() };
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [intent, setIntent] = useState<WaitlistIntent>('BUY');
  const [city, setCity] = useState<string>(WAITLIST_CITIES[0]);
  const [state, setState] = useState<'form' | 'sending' | 'joined'>('form');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === '') return setError('Please add your name.');
    if (!isContact(contact)) return setError('Add a valid phone number or email.');

    setError(null);
    setState('sending');
    const result = await joinWaitlist({ name: name.trim(), contact: contact.trim(), intent, city });
    if (result.kind === 'joined') return setState('joined');
    setState('form');
    setError(result.message);
  }

  if (state === 'sending') {
    return (
      <div className="wl">
        <div className="nl">
          <i />
          <i />
          <i />
        </div>
        <p className="note" style={{ textAlign: 'center' }}>
          Adding you to the list…
        </p>
      </div>
    );
  }

  if (state === 'joined') {
    return (
      <div className="wl">
        <div className="ok">
          <svg
            className="tick"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--trust-emerald)"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" opacity=".15" />
            <path d="M7 12.5l3.2 3.2L17 9" />
          </svg>
          <h3>You’re on the list</h3>
          <p className="note">
            We’ll contact you at {contact.trim()} when {city} opens.
          </p>
          <a className="btn bs wa wab" target="_blank" rel="noopener" href={inviteHref()}>
            <WhatsAppIcon />
            Invite a seller on WhatsApp
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="wl">
      <h3>Join the waitlist</h3>
      <p className="note" style={{ marginTop: 4 }}>
        Be first to start a trade when Komtru opens.
      </p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label className="l" htmlFor={ids.name}>
          Your name
        </label>
        <input
          className="fld"
          id={ids.name}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <label className="l" htmlFor={ids.contact}>
          Phone or email
        </label>
        <input
          className="fld"
          id={ids.contact}
          autoComplete="email"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />

        <label className="l" id={`${ids.name}-intent`}>
          I want to
        </label>
        <div className="ro" role="group" aria-labelledby={`${ids.name}-intent`}>
          {WAITLIST_INTENTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={intent === value}
              onClick={() => setIntent(value)}
            >
              {INTENT_LABELS[value]}
            </button>
          ))}
        </div>

        <label className="l" htmlFor={ids.city}>
          City
        </label>
        <select className="fld" id={ids.city} value={city} onChange={(event) => setCity(event.target.value)}>
          {WAITLIST_CITIES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>

        {error === null ? null : (
          <div className="er-t" role="alert">
            {error}
          </div>
        )}

        <button className="btn bp" type="submit" style={{ width: '100%', marginTop: 18 }}>
          Join the waitlist
        </button>
      </form>
    </div>
  );
}
