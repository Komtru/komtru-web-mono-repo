// How the address screens word an address and what the platform says about one. Pure functions, so the wording is
// tested without a DOM. A screen branches on the problem's `code` and never on its title or detail.
import { ProblemError } from '@komtru/api-client';
import { MAX_ADDRESSES_PER_USER } from '@komtru/shared-types';
import { problemMessage } from '../../trade/format';

export { MAX_ADDRESSES_PER_USER };

/**
 * The platform sends a recipient's number as E.164. The reference writes a Nigerian one the way it is dialled,
 * `0803 221 4471`, so that is what a person reads and edits; any other number is shown exactly as it came.
 */
export function localPhone(e164: string): string {
  const match = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match === null ? e164 : `0${match[1] ?? ''} ${match[2] ?? ''} ${match[3] ?? ''}`;
}

export const addressLine = (address: { streetLine: string; cityName: string; stateName: string }): string =>
  `${address.streetLine}, ${address.cityName}, ${address.stateName}`;

export type AddressAction = 'save' | 'default' | 'remove' | 'city';

const FALLBACK: Record<AddressAction, string> = {
  save: 'We couldn’t save that address. Try again.',
  default: 'We couldn’t change your default address. Nothing was changed.',
  remove: 'We couldn’t remove that address. Nothing was changed.',
  city: 'We couldn’t send that. Try again in a moment.',
};

/** A refusal in words, from its code and the action that met it. */
export function addressProblem(error: unknown, action: AddressAction): string {
  if (!(error instanceof ProblemError)) return FALLBACK[action];
  switch (error.code) {
    case 'ADDRESS_LIMIT_REACHED':
      return `You can keep ${String(MAX_ADDRESSES_PER_USER)} addresses. Remove one before adding another.`;
    case 'VALIDATION_FAILED':
      // The platform names the field in words a person can act on ("Enter a phone number we can call").
      return action === 'save'
        ? (error.problem.detail ?? 'Check the phone number and the city, then try again.')
        : FALLBACK[action];
    case 'NOT_FOUND':
      return 'That address isn’t on your account any more.';
    case 'CONFLICT':
      return action === 'save'
        ? 'That address was removed, so it can’t be changed. Add a new one instead.'
        : FALLBACK[action];
    case 'RATE_LIMITED':
    case 'UNAUTHENTICATED':
    case 'SESSION_REVOKED':
    case 'TOKEN_EXPIRED':
      return problemMessage(error, FALLBACK[action]);
    default:
      return FALLBACK[action];
  }
}
