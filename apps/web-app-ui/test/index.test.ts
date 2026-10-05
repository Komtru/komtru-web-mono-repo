import { describe, expect, it } from 'vitest';
import { workspace } from '../src/index.js';

describe('@komtru/web-app-ui', () => {
  it('identifies itself', () => {
    expect(workspace).toBe('@komtru/web-app-ui');
  });
});
