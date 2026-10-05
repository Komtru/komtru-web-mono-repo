import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertIdempotencyKey,
  beginUserAction,
  createIdempotencyKey,
  IDEMPOTENCY_KEY_PATTERN,
} from '../src/idempotency.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe('createIdempotencyKey', () => {
  it('mints a uuid v7 the server will accept', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(UUID_V7);
    // 8-255 printable ASCII, the backend's own KEY_PATTERN.
    expect(IDEMPOTENCY_KEY_PATTERN.test(key)).toBe(true);
    expect(key).toHaveLength(36);
  });

  it('mints keys that sort by the time they were made', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    const first = createIdempotencyKey();
    vi.setSystemTime(new Date('2026-10-05T10:00:01Z'));
    const second = createIdempotencyKey();
    vi.setSystemTime(new Date('2026-10-05T10:00:02Z'));
    const third = createIdempotencyKey();
    expect([first, second, third].toSorted()).toEqual([first, second, third]);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 500 }, () => createIdempotencyKey()));
    expect(keys.size).toBe(500);
  });
});

describe('assertIdempotencyKey', () => {
  it('returns a key the server would accept', () => {
    expect(assertIdempotencyKey('park-release-0001')).toBe('park-release-0001');
  });

  it('rejects a key the server would reject with a 400', () => {
    expect(() => assertIdempotencyKey('short')).toThrow(TypeError);
    expect(() => assertIdempotencyKey('a'.repeat(256))).toThrow(TypeError);
    expect(() => assertIdempotencyKey('has space')).toThrow(TypeError);
    expect(() => assertIdempotencyKey('ünicode-key')).toThrow(TypeError);
    expect(() => assertIdempotencyKey('with\nnewline')).toThrow(TypeError);
  });

  it('accepts the boundary lengths', () => {
    expect(assertIdempotencyKey('a'.repeat(8))).toHaveLength(8);
    expect(assertIdempotencyKey('a'.repeat(255))).toHaveLength(255);
  });
});

describe('beginUserAction', () => {
  it('gives one key that stays the same however often it is read', () => {
    const action = beginUserAction();
    expect(action.key).toBe(action.key);
    expect(IDEMPOTENCY_KEY_PATTERN.test(action.key)).toBe(true);
  });

  it('gives a different key to a different action', () => {
    expect(beginUserAction().key).not.toBe(beginUserAction().key);
  });

  it('adopts a key that was persisted earlier, after validating it', () => {
    expect(beginUserAction('resumed-after-reload').key).toBe('resumed-after-reload');
    expect(() => beginUserAction('nope')).toThrow(TypeError);
  });
});
