// tools/tickets/progress.py is what the owner reads the build's progress from. These tests pin the
// two things that silently went wrong before: MVP.md's ticket scrape counted deferred tickets named
// in prose (80 against a stated 77), and the feature view must agree with FEATURE_MAP.md.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const toolsDir = join(root, 'tools', 'tickets');

/** Runs a Python snippet with progress.py importable as `P`; returns parsed stdout JSON. */
function py(snippet: string): { status: number | null; out: string; err: string } {
  const run = spawnSync(
    'python3',
    ['-c', `import json, sys\nsys.path.insert(0, sys.argv[1])\nimport progress as P\n${snippet}`, toolsDir],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return { status: run.status, out: run.stdout, err: run.stderr };
}

describe('progress.py MVP ticket scrape', () => {
  it('matches the count MVP.md states and ignores deferred tickets named in prose', () => {
    const run = py(
      'ids, declared, problems = P.parse_mvp_included(P.MVP.read_text())\nprint(json.dumps([sorted(ids), declared, problems]))',
    );
    expect(run.status).toBe(0);
    const [ids, declared, problems] = JSON.parse(run.out) as [string[], number, string[]];
    expect(problems).toEqual([]);
    expect(ids).toHaveLength(declared);
    expect(declared).toBe(77);
    for (const deferred of ['T-201', 'T-210', 'T-214']) expect(ids).not.toContain(deferred);
  });

  it('fails loudly when the parsed ids disagree with the stated header', () => {
    const doc = [
      '## Included — 3 tickets',
      '',
      '### Trades (2)',
      '',
      'T-061 proposal flow · T-063 orders',
      '',
      'T-201 stays deferred, and so do T-210 and T-214.',
    ].join('\n');
    const run = py(`print(json.dumps(P.parse_mvp_included(${JSON.stringify(doc)})[2]))`);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.out)).toEqual(["'## Included' states 3 tickets but 2 were parsed"]);
  });

  it('refuses to report when MVP.md and the parser disagree', () => {
    const run = py(
      `P.MVP = type('M', (), {'exists': lambda self: True, 'read_text': lambda self: "## Included — 5 tickets\\n\\n### Trades (1)\\n\\nT-061 proposal flow\\n"})()\nP.mvp_ids()`,
    );
    expect(run.status).not.toBe(0);
    expect(run.err).toContain('disagree');
  });
});

describe('progress.py feature view', () => {
  it('counts only Status: Done as done and agrees with FEATURE_MAP.md', () => {
    const run = py(
      'f = P.features()\nn = P.feature_numbers(f)\nprint(json.dumps([len(f), len(n["mvp"]), len(n["done"]), len(n["mvp_done"]), len(n["backend_only"]), sorted({d["status"] for d in f.values()})]))',
    );
    expect(run.status).toBe(0);
    const [total, mvp, done, mvpDone, backendOnly, statuses] = JSON.parse(run.out) as [
      number,
      number,
      number,
      number,
      number,
      string[],
    ];
    expect(statuses.every((s) => ['Done', 'Backend done, UI outstanding', 'Not started'].includes(s))).toBe(
      true,
    );
    expect(done).toBeLessThanOrEqual(mvp);
    expect(mvpDone).toBeLessThanOrEqual(done);
    expect(backendOnly + done).toBeLessThan(total);
  });

  it('leads the default output with the feature bars', () => {
    const run = spawnSync('python3', [join(toolsDir, 'progress.py')], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(0);
    const [first, second] = run.stdout.split('\n');
    expect(first).toMatch(/^MVP {3}\S+ {2}\d+\/\d+ {3}\(\d+%\)$/);
    expect(second).toMatch(/^Total \S+ {2}\d+\/\d+ {3}\(\d+%\)$/);
  });

  it('treats a missing Status or MVP bullet as an error', () => {
    const run = py('P.parse_features("### Journey: J\\n\\n#### F-001 — x\\n\\n- **Status:** Done\\n")');
    expect(run.status).not.toBe(0);
    expect(run.err).toContain('missing a Status or MVP');
  });
});
