import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/park-agent-app', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/park-agent-app');
  });
});
