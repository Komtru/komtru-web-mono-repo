import { describe, expect, it } from 'vitest';
import { findScreen, loadScreens } from '../src/screen-index.js';

const rows = loadScreens();

describe('the screen index', () => {
  it('parses every row', () => {
    expect(rows).toHaveLength(210);
    expect(rows[0]).toEqual({
      id: 'E1',
      screen: 'Welcome',
      section: 'Entry — Mobile Web',
      line: 1945,
      app: 'web-app-ui',
      ticket: 'T-111',
    });
  });

  it('finds a screen by id', () => {
    expect(findScreen(rows, 'P2-D1')).toMatchObject({ line: 3061, app: 'web-app-ui', ticket: 'T-113' });
  });

  it('names the id it cannot find', () => {
    expect(() => findScreen(rows, 'NOPE')).toThrow(/NOPE/);
  });

  it('refuses the one id the reference shows twice', () => {
    expect(() => findScreen(rows, 'TO-PA10')).toThrow(/TO-PA10[\s\S]*--line/);
  });

  it('takes the line when an id is ambiguous', () => {
    expect(findScreen(rows, 'TO-PA10', 8336)).toMatchObject({ line: 8336 });
  });
});
