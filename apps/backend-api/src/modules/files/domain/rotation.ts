// Cannibalized from kumtru/backend-apis/src/modules/files/domain/rotation.ts (T-001). Adapted: the
// old file's comment about `@db/index` opening a pool at import does not apply here (this backend
// injects `Db`), so the placement note is dropped; the function itself is unchanged.

/**
 * The arithmetic behind quota-aware round-robin (M20 §5 step 5).
 *
 * In `domain/` because it is genuinely pure, and that is the reason the test exists: the wrap-around
 * and the "the account we used last is no longer a candidate" case are both invisible from the
 * outside. You cannot tell a correct wrap from a silent reset to the top by watching uploads.
 */
export const nextInRotation = <T extends { id: string }>(
  candidates: readonly T[],
  lastAccountId: string | null,
): T => {
  const first = candidates[0];

  if (!first) throw new Error('nextInRotation called with no candidates');

  const lastIndex = lastAccountId ? candidates.findIndex((candidate) => candidate.id === lastAccountId) : -1;

  // -1 covers both "never rotated" and "the account we used last is no longer eligible" — in the
  // second case starting from the top is right, because the ordering is by rotation_order and not by
  // history.
  return candidates[(lastIndex + 1) % candidates.length] ?? first;
};
