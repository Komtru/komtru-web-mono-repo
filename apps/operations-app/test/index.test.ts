import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/operations-app', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/operations-app');
  });
});
