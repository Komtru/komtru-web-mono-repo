import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import { readContact, type WaitlistIntent } from '../domain/contact.js';
import { waitlistSignups } from '../schema.js';

export interface SignupInput {
  readonly name: string;
  readonly contact: string;
  readonly intent: WaitlistIntent;
  readonly city: string;
}

export interface SignupResult {
  readonly id: string;
  readonly createdAt: string;
}

/**
 * The unique index on the normalised contact. Named, not sniffed for any 23505: a violation of some
 * other constraint is a bug, and answering it "you're already on the list" would hide it.
 *
 * `isUniqueViolation` rather than reading `error.code`: drizzle wraps the driver's error in a
 * `DrizzleQueryError` and puts the `pg` one on `cause`, so the obvious check reads `undefined` and
 * turns a perfectly good 409 into a 500. `src/db/errors.ts` says so, and this is why.
 */
const CONTACT_INDEX = 'signups_contact_key';

/**
 * Add someone to the launch waitlist.
 *
 * The duplicate is caught from the constraint rather than checked for first: a select-then-insert
 * races two taps of the same button, and the index is the thing that actually decides. The 409 it
 * answers is what the site treats as success — from the person's side, they are on the list either
 * way.
 */
export async function addSignup(db: Db, input: SignupInput): Promise<SignupResult> {
  const read = readContact(input.contact);
  if (read === undefined) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'We need a way to reach you',
      'Enter a phone number or an email address.',
      [{ path: 'contact', message: 'Not a phone number or an email address' }],
    );
  }

  const name = input.name.trim();
  if (name === '') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'We need your name', undefined, [
      { path: 'name', message: 'Required' },
    ]);
  }

  try {
    const [row] = await db
      .insert(waitlistSignups)
      .values({
        name,
        contact: read.contact,
        contactKey: read.contactKey,
        channel: read.channel,
        intent: input.intent,
        city: input.city.trim(),
      })
      .returning({ id: waitlistSignups.id, createdAt: waitlistSignups.createdAt });

    if (row === undefined) throw new Error('waitlist: the insert returned no row');
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  } catch (error) {
    if (isUniqueViolation(error, CONTACT_INDEX)) {
      throw new ApiError(
        409,
        'CONFLICT',
        'You’re already on the list',
        'We have this contact already. We’ll message you when your city opens.',
      );
    }
    throw error;
  }
}
