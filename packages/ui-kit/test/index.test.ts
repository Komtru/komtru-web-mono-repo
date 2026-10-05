import { describe, expect, it } from 'vitest';
import * as uiKit from '../src/index.js';

describe('@komtru/ui-kit', () => {
  it('exposes the tokens and the brand components', () => {
    expect(Object.keys(uiKit).sort()).toEqual(['KOMTRU_TOKENS', 'KomtruLogo', 'KomtruMark', 'cssVar']);
  });
});
