/**
 * How a waitlist contact is read and compared.
 *
 * The site asks for "phone or email" in one box on purpose — asking someone to pick first is one
 * more decision in front of the only thing the form is for. So the channel is inferred here, and
 * the normalised form is what the unique index is on, because the same person typing their number
 * two different ways must not become two rows to message twice.
 */

export const WAITLIST_CHANNELS = ['EMAIL', 'PHONE'] as const;
export type WaitlistChannel = (typeof WAITLIST_CHANNELS)[number];

export const WAITLIST_INTENTS = ['BUY', 'SELL', 'BOTH'] as const;
export type WaitlistIntent = (typeof WAITLIST_INTENTS)[number];

/** An `@` with something either side and a dot in the domain. Deliberately not RFC 5322. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nigeria. The site is Nigeria-only at launch and every city on the form is Nigerian. */
const COUNTRY_CODE = '234';

/**
 * A Nigerian number in one comparable form: `234` followed by the ten significant digits.
 *
 * `08012345678`, `8012345678`, `+234 801 234 5678` and `234-801-234-5678` are one person. A number
 * this does not recognise is kept as its own digits rather than rejected — the form's job is to
 * collect a way to reach someone, and a diaspora number typed by someone waiting for Lagos to open
 * is a real signup.
 */
function normalisePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith(COUNTRY_CODE) && digits.length === 13) return digits;
  // The national trunk prefix: 0 then the ten significant digits.
  if (digits.startsWith('0') && digits.length === 11) return `${COUNTRY_CODE}${digits.slice(1)}`;
  // The same ten digits with the trunk prefix left off. `!startsWith('0')` matters: a ten-digit
  // string that begins with 0 is not a Nigerian number missing its prefix, it is a number missing
  // a digit, and prefixing it would file it under a key no real number can ever match.
  if (digits.length === 10 && !digits.startsWith('0')) return `${COUNTRY_CODE}${digits}`;
  return digits;
}

export interface ReadContact {
  /** Trimmed, as typed. */
  readonly contact: string;
  readonly contactKey: string;
  readonly channel: WaitlistChannel;
}

/**
 * Read a contact, or say it cannot be read.
 *
 * The phone branch asks for at least eight digits, matching the site's own check, so a stray word
 * is a validation failure rather than a row nobody can ever be reached at.
 */
export function readContact(raw: string): ReadContact | undefined {
  const contact = raw.trim();
  if (contact === '') return undefined;

  if (EMAIL.test(contact)) {
    return { contact, contactKey: contact.toLowerCase(), channel: 'EMAIL' };
  }

  const digits = contact.replace(/\D/g, '');
  if (digits.length < 8) return undefined;
  return { contact, contactKey: normalisePhone(contact), channel: 'PHONE' };
}
