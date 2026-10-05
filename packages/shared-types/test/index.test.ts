import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/shared-types', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/shared-types');
  });
});
