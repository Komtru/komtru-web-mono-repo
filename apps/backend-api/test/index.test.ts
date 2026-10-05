import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/backend-api', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/backend-api');
  });
});
