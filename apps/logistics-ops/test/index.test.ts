import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/logistics-ops', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/logistics-ops');
  });
});
