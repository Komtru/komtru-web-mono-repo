import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/ui-kit', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/ui-kit');
  });
});
