import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/api-client', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/api-client');
  });
});
