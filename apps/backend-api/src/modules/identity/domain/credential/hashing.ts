// Cannibalized from kumtru/backend-apis/src/modules/identity/domain/credential/hashing.ts (T-001),
// adapted: the free functions gained a `PasswordHasher` port around them, so a caller that must
// prove it does the same work on every path (login, §S3) can be handed a cheap implementation in a
// test and still be the same code in production.
//
// Password hashing (§S1).
//
// argon2id at m=19456 KiB, t=2, p=1 — the OWASP baseline. The parameters travel inside the PHC
// string, which is what makes `needsRehash` possible: raising the cost later does not invalidate
// existing hashes, it just marks them for transparent upgrade on the owner's next successful login.
//
// The only two operations this module exposes are hash and verify. There is no "compare to a plain
// string", no truncation, and no pepper — the pepper lives on HMAC'd identifiers, where a server-side
// secret buys something; on an argon2 hash it buys almost nothing and adds a key-rotation problem.
import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id`, spelled as a literal: the enum the package exports is an ambient `const
 * enum`, which `isolatedModules` cannot inline (TS2748), so reading the member would not compile.
 */
const ARGON2ID = 2 as Algorithm;

export const ARGON2_PARAMS = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
});

export const PASSWORD_ALGORITHM = 'argon2id';

export const hashPassword = async (plaintext: string): Promise<string> =>
  hash(plaintext, {
    algorithm: ARGON2_PARAMS.algorithm,
    memoryCost: ARGON2_PARAMS.memoryCost,
    timeCost: ARGON2_PARAMS.timeCost,
    parallelism: ARGON2_PARAMS.parallelism,
  });

/**
 * Constant-time verification against a stored PHC string.
 *
 * Returns `false` on a malformed or unparseable hash rather than throwing: a corrupt row must read as
 * "wrong password" to the caller, so it cannot be distinguished from any other failure (§S3).
 */
export const verifyPassword = async (plaintext: string, phcHash: string): Promise<boolean> => {
  try {
    return await verify(phcHash, plaintext);
  } catch {
    return false;
  }
};

/**
 * True when `phcHash` was produced with weaker parameters than the current baseline, so the caller
 * should re-hash after a successful verify.
 *
 * Parses the PHC string rather than storing parameters in a column: the hash is self-describing, and
 * a separate column is one more thing that can drift out of sync with reality.
 */
export const needsRehash = (phcHash: string): boolean => {
  const match = /^\$(argon2(?:id|i|d))\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phcHash);

  // Unrecognised format — a legacy bcrypt row, say. Upgrade it on next login.
  if (!match) return true;

  const [, algorithm, , memory, time, parallelism] = match;

  if (algorithm !== PASSWORD_ALGORITHM) return true;

  return (
    Number(memory) < ARGON2_PARAMS.memoryCost ||
    Number(time) < ARGON2_PARAMS.timeCost ||
    Number(parallelism) < ARGON2_PARAMS.parallelism
  );
};

/**
 * A dummy hash to verify against when the account does not exist or has no password row.
 *
 * §S3 requires that a nonexistent user, a wrong password and a social-only account are
 * indistinguishable — including in TIMING. Skipping the argon2 work on the miss path would make the
 * miss ~60ms faster than the hit, which is a trivially measurable enumeration oracle. So the miss
 * path verifies a real hash of a value nothing can match.
 *
 * Generated once at module load, from a random secret, so it is never a known-plaintext target.
 */
let decoyHash: string | undefined;

export const getDecoyHash = async (): Promise<string> => {
  decoyHash ??= await hashPassword(`decoy:${Math.random().toString(36)}:${String(Date.now())}`);
  return decoyHash;
};

/** Burns the same CPU as a real verification and always fails. Never short-circuit this. */
export const performDecoyVerification = async (attempted: string): Promise<false> => {
  await verifyPassword(attempted, await getDecoyHash());
  return false;
};

/**
 * The port every service takes instead of importing the functions directly.
 *
 * It exists for one test: §S17 asks that `POST /auth/login` differ by under 5ms between an existing
 * and a nonexistent user over 1,000 samples. Measuring that against real argon2 costs two minutes of
 * CPU and measures the thing that is identical by construction; measuring it against a cheap hasher
 * measures the DATABASE work on the two paths, which is where a difference would actually hide.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, phcHash: string): Promise<boolean>;
  needsRehash(phcHash: string): boolean;
  /** Same cost as `verify`, always false. The miss path's obligation under §S3. */
  decoy(attempted: string): Promise<false>;
}

export const argon2Hasher: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
  needsRehash,
  decoy: performDecoyVerification,
};
