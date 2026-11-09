import { describe, expect, it, vi } from 'vitest';
import { findScreen, loadScreens, ticketId } from '../src/screen-index.ts';

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

describe('ticketId', () => {
  it('is the ticket the output directory is named after', () => {
    expect(ticketId(findScreen(rows, 'E1'))).toBe('T-111');
  });

  it('drops the prose from the one row that annotates its ticket', () => {
    const annotated = rows.find((row) => /\(/.test(row.ticket));
    expect(annotated?.ticket).toMatch(/\(/);
    expect(ticketId(annotated!)).toMatch(/^T-\d{3}$/);
  });

  it('refuses a row that names no ticket', () => {
    expect(() => ticketId({ ...rows[0]!, ticket: 'none' })).toThrow(/E1/);
  });
});

describe('the reference selector', () => {
  it('draws against the v2 master and its index unless told otherwise', async () => {
    vi.resetModules();
    vi.stubEnv('KOMTRU_VISUAL_CHECK_REFERENCE', undefined);
    try {
      const module = await import('../src/screen-index.ts');
      expect(module.SCREEN_INDEX_PATH.pathname).toMatch(/SCREEN_INDEX\.md$/);
      expect(module.REFERENCE_NAME).toBe('Komtru — UI Living Master v2.html');
      expect(findScreen(module.loadScreens(), 'TC-05')).toMatchObject({ line: 10315, ticket: 'T-115' });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('reads the v1 file and index when KOMTRU_VISUAL_CHECK_REFERENCE=v1', async () => {
    const module = await import('../src/screen-index.ts');
    expect(module.SCREEN_INDEX_PATH.pathname).toMatch(/SCREEN_INDEX-v1\.md$/);
    expect(module.REFERENCE_NAME).toBe('Komtru — UI Screens Living Master File.html');
  });
});
