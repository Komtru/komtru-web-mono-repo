import { describe, expect, it } from 'vitest';

import { mergeStub, renderStub, type StubInput } from '../src/report.ts';

const sample: StubInput = {
  row: {
    id: 'U4',
    screen: 'Handover Confirmation',
    section: 'Logistics — Mobile Web',
    line: 4321,
    app: 'web-app-ui',
    ticket: 'T-123',
  },
  url: 'http://localhost:3004/handover/KMT-88213',
  device: 'mobile',
  frameWidth: 340,
  compared: { width: 340, height: 660 },
  diff: { changed: 1204, total: 224_400, ratio: 1204 / 224_400 },
  files: { sideBySide: 'U4.png', heatMap: 'U4.diff.png' },
};

describe('the deviation stub', () => {
  it('names the screen, the reference line, the URL and the score', () => {
    const md = renderStub(sample);
    expect(md).toContain('# U4 — Handover Confirmation');
    expect(md).toContain('T-123');
    expect(md).toContain('line 4321');
    expect(md).toContain('http://localhost:3004/handover/KMT-88213');
    expect(md).toContain('340 × 660');
    expect(md).toContain('mobile');
    expect(md).toContain('0.54%');
    expect(md).toContain('U4.png');
    expect(md).toContain('U4.diff.png');
  });

  it('leaves a place for the deviation list', () => {
    expect(renderStub(sample)).toContain('## Deviations');
  });

  it('does not churn on metadata that changes every run', () => {
    // The file is committed; a timestamp above the merge boundary would show a diff on every run
    // of a page that changes every commit. `git log` already says when a review was taken.
    expect(renderStub(sample)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps a hand-written deviation list across runs', () => {
    const written = `${renderStub(sample)}\n- [ ] the Protect button is 2px short\n`;
    const merged = mergeStub(written, renderStub({ ...sample, diff: { changed: 0, total: 1, ratio: 0 } }));
    expect(merged).toContain('Protect button is 2px short');
    expect(merged).toContain('0.00%');
    expect(merged).not.toContain('0.54%');
  });

  it('starts from the fresh stub when there is nothing to keep', () => {
    expect(mergeStub('', renderStub(sample))).toBe(renderStub(sample));
    expect(mergeStub('   \n', renderStub(sample))).toBe(renderStub(sample));
  });

  it('keeps a review whose heading was renamed or deleted rather than dropping it', () => {
    const edited = '# U4 by hand\n\n- the Protect button is 2px short\n';
    const merged = mergeStub(edited, renderStub(sample));
    expect(merged).toContain('Protect button is 2px short');
    expect(merged).toContain('# U4 — Handover Confirmation');
  });

  it('anchors on the heading instead of the first substring that looks like it', () => {
    const edited = `${renderStub(sample)}\n### Deviations by area\n\n- [ ] kept\n`;
    const merged = mergeStub(edited, renderStub(sample));
    expect(merged).toContain('### Deviations by area');
    expect(merged).toContain('- [ ] kept');
  });
});
