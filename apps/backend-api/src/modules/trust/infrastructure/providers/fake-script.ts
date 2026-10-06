// What the fake KYC provider answers, as a pure function of its input.
//
// Two properties make this worth more than a stub that returns `{ passed: true }`:
//
//  1. **It is reproducible.** The same number gets the same verdict on every machine and every run,
//     so a developer, a test and a reviewer are all looking at the same scenario, and a bug
//     reproduces from the number alone.
//  2. **It says no.** A fake that always passes exercises one branch of the code that handles five,
//     and the four it never reaches are the four that will be wrong the day a real provider is
//     wired in. One digit in ten stalls, one fails, one asks for review, one throws — the failure
//     paths are the default, not an opt-in a test has to remember to configure.
//
// The mapping is by trailing digit so it is usable by hand: `...0` stalls, `...1` fails, `...2`
// needs review, `...3` errors, anything else passes. It is documented in the ticket note for the
// same reason.
//
// Deliberately not a `*.client.ts`: this is pure, has no credential and reaches nothing. Keeping the
// script out of the client is the split T-040 made between `cloudinary.signing.ts` and
// `cloudinary.client.ts`, and it is what lets these decisions be unit-tested at all.
import { createHash, randomUUID } from 'node:crypto';

/** `ERROR` is not a verdict a provider returns — it is the adapter throwing, which jobs retry. */
export type ScriptedOutcome = 'PASSED' | 'FAILED' | 'LOW_CONFIDENCE' | 'PENDING' | 'ERROR';

const BY_TRAILING_DIGIT: Record<string, ScriptedOutcome> = {
  '0': 'PENDING',
  '1': 'FAILED',
  '2': 'LOW_CONFIDENCE',
  '3': 'ERROR',
};

export const scriptFor = (normalised: string): ScriptedOutcome =>
  BY_TRAILING_DIGIT[normalised.slice(-1)] ?? 'PASSED';

/**
 * Liveness, keyed on the selfie's M20 file id rather than on a number the user typed.
 *
 * Two hex endings are reserved so a test — and a developer with a seeded file id — can reach the
 * refusal and the borderline case. Everything else passes, because a selfie that the client got as
 * far as uploading usually is one.
 */
export const livenessScriptFor = (selfieStorageRef: string): Exclude<ScriptedOutcome, 'ERROR'> => {
  const last = selfieStorageRef.slice(-1).toLowerCase();
  if (last === 'f') return 'FAILED';
  if (last === 'e') return 'LOW_CONFIDENCE';
  if (last === 'd') return 'PENDING';
  return 'PASSED';
};

/** A stable number in `[min, max)` derived from the input, so scores vary without being random. */
const spread = (seed: string, min: number, max: number): number => {
  const digest = createHash('sha256').update(seed).digest();
  // Two bytes is 1/65536 granularity — far finer than the two decimal places the column keeps.
  const fraction = digest.readUInt16BE(0) / 0x1_00_00;
  return Math.round((min + fraction * (max - min)) * 100) / 100;
};

/**
 * Scores by band, not a constant.
 *
 * A `name_match_score` pinned at 100 would make the column look decided when nothing decided it, and
 * any threshold a later ticket puts on it would be untested against a realistic distribution. The
 * bands are separated so that "passed" and "needs review" are genuinely different numbers.
 */
export const scoreFor = (outcome: ScriptedOutcome, seed: string): number => {
  if (outcome === 'PASSED') return spread(seed, 85, 99.99);
  if (outcome === 'LOW_CONFIDENCE') return spread(seed, 55, 74.99);
  return spread(seed, 0, 40);
};

/**
 * A provider-shaped reference: random per call, recognisably not a real vendor's id.
 *
 * It is NOT derived from the identifier, and that is a correction rather than a preference. The
 * reference is persisted in `nin_verifications.provider_reference`, which D1 names among the three
 * things it is safe to keep — but a truncated unkeyed SHA-256 of an eleven-digit number is not safe.
 * The whole NIN space is 10^11, so that column would have been a rainbow table for exactly the value
 * the KEYED hash in the column beside it exists to protect, and both D1 scans would have missed it
 * because they look for the literal digits.
 *
 * Randomness also happens to be the faithful behaviour: a real provider's call id has nothing to do
 * with what was asked. The fake's determinism belongs to the VERDICT, which is what a developer
 * reproduces from; the reference is opaque in every implementation.
 */
export const referenceFor = (operation: string): string =>
  `fake_${operation}_${randomUUID().replaceAll('-', '')}`;
