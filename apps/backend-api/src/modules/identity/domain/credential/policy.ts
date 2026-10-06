// What makes a password acceptable (§S2): length, a breach corpus, and nothing else.
//
// There are deliberately NO composition rules. "One uppercase, one digit, one symbol" moves users
// from `correcthorsebatterystaple` to `Password1!`, which is in every corpus ever published; length
// plus a breach check is what actually removes guessable passwords. The only two additions here are
// an offline list, which is what the breach check falls back to when HIBP cannot be reached, and a
// refusal to let the password be the identifier it protects — which no corpus catches, because
// `janedoe2026` is only weak for Jane.
export const MIN_PASSWORD_LENGTH = 10;

/**
 * argon2 will hash a megabyte quite happily, and will spend the CPU to do it. A bound on a public
 * registration field is what stops that being a free denial of service.
 */
export const MAX_PASSWORD_LENGTH = 256;

/** Below this an identifier fragment appears in ordinary passwords by chance (`+234`, `ng`). */
const MIN_IDENTIFIER_FRAGMENT = 4;

export type PasswordRejection =
  'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | 'CONTAINS_IDENTIFIER' | 'BREACHED' | 'REUSED';

export interface PasswordVerdict {
  ok: boolean;
  rejection?: PasswordRejection;
  message?: string;
}

/**
 * The copy the user reads. It never names the corpus or the rule's internals: "this password has
 * appeared in a breach" is actionable, "HIBP returned a count of 12345 for prefix 5BAA6" is a
 * description of our implementation and a hint to anyone probing it.
 */
export const PASSWORD_REJECTION_MESSAGE: Record<PasswordRejection, string> = {
  TOO_SHORT: `Use at least ${String(MIN_PASSWORD_LENGTH)} characters. A short phrase you can remember beats a short word you cannot.`,
  TOO_LONG: `Use at most ${String(MAX_PASSWORD_LENGTH)} characters.`,
  COMMON: 'This password is one of the most commonly used ones. Pick something only you would think of.',
  CONTAINS_IDENTIFIER: 'This password contains your own email, phone or handle. Pick something unrelated.',
  BREACHED: 'This password has appeared in a public data breach. Pick a different one.',
  REUSED: 'This is one of your recent passwords. Pick one you have not used here before.',
};

/**
 * The offline fallback. Short by design: it exists for the minutes HIBP is unreachable, not as a
 * replacement for a 900-million-entry corpus. Only entries that would pass the length check are
 * worth listing — anything shorter is already rejected.
 */
export const OFFLINE_WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890',
  '12345678901',
  '123456789012',
  'password12',
  'password123',
  'password1234',
  'passw0rd12',
  'qwerty1234',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou12',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'welcome1234',
  'admin12345',
  'administrator',
  'abc123456789',
  'football12',
  'baseball12',
  'sunshine12',
  'princess12',
  'superman12',
  'trustno1234',
  'monkey1234',
  'dragon1234',
  'master1234',
  'michael123',
  'jennifer12',
  'charlie123',
  'nigeria123',
  'naija12345',
  'chelsea123',
  'arsenal123',
  'manchester',
  'changeme123',
  'passwordpassword',
  'komtru12345',
  'whatsapp123',
  'blessing123',
]);

const normalise = (value: string): string => value.trim().toLowerCase();

/**
 * Length, the offline list, and the identifier check. The breach corpus is NOT consulted here: it is
 * asynchronous and may be unavailable, so `credential.service.ts` runs it separately and maps a hit
 * onto `BREACHED` using this module's message table.
 */
export const checkPasswordPolicy = (
  password: string,
  context: { identifiers?: readonly string[] } = {},
): PasswordVerdict => {
  const reject = (rejection: PasswordRejection): PasswordVerdict => ({
    ok: false,
    rejection,
    message: PASSWORD_REJECTION_MESSAGE[rejection],
  });

  // Length is measured on what will be hashed, not on the trimmed form: a leading space is a
  // character of the password and removing it would silently change what the user chose.
  if (password.length < MIN_PASSWORD_LENGTH) return reject('TOO_SHORT');
  if (password.length > MAX_PASSWORD_LENGTH) return reject('TOO_LONG');

  const folded = normalise(password);
  if (OFFLINE_WEAK_PASSWORDS.has(folded)) return reject('COMMON');

  for (const identifier of context.identifiers ?? []) {
    const candidate = normalise(identifier);
    if (candidate.length < MIN_IDENTIFIER_FRAGMENT) continue;
    if (folded.includes(candidate)) return reject('CONTAINS_IDENTIFIER');
    // The local part on its own: `jane` out of `jane@example.com` is the half a user actually reuses.
    const local = candidate.split('@')[0] ?? '';
    if (local.length >= MIN_IDENTIFIER_FRAGMENT && folded.includes(local)) {
      return reject('CONTAINS_IDENTIFIER');
    }
  }

  return { ok: true };
};
