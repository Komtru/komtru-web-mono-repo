'use client';

import { useId, useRef, useState } from 'react';
import { CONTACT } from '../site/nav';

/**
 * The "Send us a message" card.
 *
 * It posts nothing. The reference's handler built a `mailto:` link and so does this one, because
 * this site makes exactly one backend call — `POST /v1/waitlist` — and a contact endpoint would
 * be a second. A `mailto:` is the only way to keep the form without adding one.
 *
 * The form is kept rather than dropped because the select in it is the useful part: it tells
 * someone writing in what we need to know, and it lands the message in the right queue. But a
 * `mailto:` does nothing visible on a machine with no mail client configured, which is most
 * phones that only use webmail. So the address is never only inside this button: the Email card
 * above shows `support@komtru.com` as plain, selectable text, and the line this form prints after
 * submitting repeats it. Someone whose mail app never opens still has the address on screen.
 */

/** The reference's four options, in its order. */
export const TOPICS = ['A Trade', 'My account', 'Running a hub or partnership', 'Something else'] as const;

/**
 * The link the Send button follows, built exactly as the reference's handler built it: the topic
 * and the sender's name in the subject, the message in the body with the name and phone repeated
 * underneath so the reply has them even when the mail client rewrites the From address.
 *
 * Exported so the shape of the link can be tested without a test navigating the page away.
 */
export function mailtoHref(fields: {
  readonly topic: string;
  readonly name: string;
  readonly phone: string;
  readonly message: string;
}): string {
  const subject = `${fields.topic} — ${fields.name.trim()}`;
  const body = `${fields.message.trim()}\n\nName: ${fields.name.trim()}\nPhone: ${fields.phone.trim()}`;
  return `mailto:${CONTACT.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

type FieldName = 'name' | 'phone' | 'message';

type Status =
  | { readonly kind: 'error'; readonly text: string; readonly bad: readonly FieldName[] }
  | { readonly kind: 'sent'; readonly text: string };

export function ContactForm(): React.JSX.Element {
  const ids = { name: useId(), phone: useId(), topic: useId(), message: useId(), status: useId() };
  // Three separate refs rather than one object of them: `react-hooks/refs` reads a member access
  // on a ref-holding object as reading a ref during render and fails the lint.
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status | null>(null);

  const bad = (field: FieldName): boolean => status?.kind === 'error' && status.bad.includes(field);
  const describedBy = status === null ? undefined : ids.status;

  function submit(event: React.FormEvent): void {
    event.preventDefault();

    const empty = (
      [
        ['name', name],
        ['phone', phone],
        ['message', message],
      ] as const
    )
      .filter(([, value]) => value.trim() === '')
      .map(([field]) => field);

    const first = empty[0];
    if (first !== undefined) {
      setStatus({
        kind: 'error',
        text: 'Please add your name, phone number and a message.',
        bad: empty,
      });
      const focus: Record<FieldName, React.RefObject<HTMLElement | null>> = {
        name: nameRef,
        phone: phoneRef,
        message: messageRef,
      };
      focus[first].current?.focus();
      return;
    }

    window.location.href = mailtoHref({ topic, name, phone, message });

    setStatus({
      kind: 'sent',
      text: `Your email app should open with your message ready. If it doesn’t, write to ${CONTACT.supportEmail}.`,
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="l" htmlFor={ids.name}>
        Your name
      </label>
      <input
        className={bad('name') ? 'fld er' : 'fld'}
        id={ids.name}
        ref={nameRef}
        autoComplete="name"
        aria-invalid={bad('name')}
        aria-describedby={describedBy}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <label className="l" htmlFor={ids.phone}>
        Phone number
      </label>
      <input
        className={bad('phone') ? 'fld er' : 'fld'}
        id={ids.phone}
        ref={phoneRef}
        type="tel"
        autoComplete="tel"
        aria-invalid={bad('phone')}
        aria-describedby={describedBy}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />

      <label className="l" htmlFor={ids.topic}>
        What’s it about?
      </label>
      <select className="fld" id={ids.topic} value={topic} onChange={(event) => setTopic(event.target.value)}>
        {TOPICS.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>

      <label className="l" htmlFor={ids.message}>
        Message
      </label>
      <textarea
        className={bad('message') ? 'fld er' : 'fld'}
        id={ids.message}
        ref={messageRef}
        rows={4}
        aria-invalid={bad('message')}
        aria-describedby={describedBy}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />

      {/*
        One live region for both outcomes, so the confirmation is announced as well as the error.
        The reference reused its error element the same way and recoloured it green.
      */}
      {status === null ? null : (
        <div
          className="er-t"
          id={ids.status}
          role="alert"
          style={status.kind === 'sent' ? { color: 'var(--success-on-soft)' } : undefined}
        >
          {status.text}
        </div>
      )}

      <button className="btn bp" type="submit" style={{ width: '100%', marginTop: 18 }}>
        Send
      </button>
    </form>
  );
}
