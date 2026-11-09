import { describe, expect, it } from 'vitest';
import { avatarSchema, setAvatarBodySchema } from '../src/avatar.js';

describe('avatar contracts', () => {
  it('accepts a uuid file id and nothing else', () => {
    expect(setAvatarBodySchema.safeParse({ fileId: '0190b0a0-0000-7000-8000-000000000001' }).success).toBe(
      true,
    );
    expect(setAvatarBodySchema.safeParse({ fileId: 'nope' }).success).toBe(false);
    expect(setAvatarBodySchema.safeParse({}).success).toBe(false);
  });

  it('answers a url or null', () => {
    expect(avatarSchema.parse({ avatarUrl: null })).toEqual({ avatarUrl: null });
    expect(avatarSchema.parse({ avatarUrl: 'https://cdn.test/a.jpg' }).avatarUrl).toBe(
      'https://cdn.test/a.jpg',
    );
    expect(avatarSchema.safeParse({}).success).toBe(false);
  });
});
