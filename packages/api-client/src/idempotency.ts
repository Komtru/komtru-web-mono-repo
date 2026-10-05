// An idempotency key belongs to a *user action*, not to an HTTP attempt. The buyer tapped "Fund",
// the agent tapped "Release": however many requests that takes — a refresh retry, a backoff, a
// replay from the durable queue three hours later — the server must see one key, so it answers with
// the first result instead of releasing a parcel twice.
import { v7 as uuidv7 } from 'uuid';

/**
 * The server's own rule, copied from `apps/backend-api/src/platform/http/idempotency.ts`: 8 to 255
 * printable ASCII characters. Checked here so an app's own key fails at the call site rather than
 * coming back as a 400 from production.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{8,255}$/;

/** UUID v7: 36 characters, time-ordered, so queued keys sort into the order they were created. */
export const createIdempotencyKey = (): string => uuidv7();

export function assertIdempotencyKey(key: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new TypeError('An Idempotency-Key must be 8 to 255 printable ASCII characters, such as a UUID');
  }
  return key;
}

/**
 * One user action. Hold it for as long as the user is still trying to do the same thing — across a
 * "try again" tap, across a reload if it was persisted — and pass its key to every call.
 */
export interface UserAction {
  readonly key: string;
}

export const beginUserAction = (key?: string): UserAction => ({
  key: key === undefined ? createIdempotencyKey() : assertIdempotencyKey(key),
});
