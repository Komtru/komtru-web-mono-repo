import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { feeValuesToGuard, findFeeViolations } from './support/fee-guard.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const feesText = readFileSync(resolve(repoRoot, 'config/fees.yaml'), 'utf8');
const VALUES = feeValuesToGuard(feesText);

let built: string | undefined;
afterEach(async () => {
  if (built) await rm(built, { recursive: true, force: true });
  built = undefined;
});

/** Writes `files` (path relative to the modules root) into a throwaway modules tree. */
const tree = async (files: Record<string, string>): Promise<string> => {
  built = await mkdtemp(join(tmpdir(), 'komtru-fee-guard-'));
  for (const [file, source] of Object.entries(files)) {
    const full = join(built, file);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, source, 'utf8');
  }
  return built;
};

describe('feeValuesToGuard', () => {
  it('takes the distinctive values out of the fee file', () => {
    expect(VALUES).toEqual(expect.arrayContaining(['150', '30000', '50000', '2026-10-05.1']));
  });

  it('leaves 0 and the booleans alone', () => {
    // A `0` in a loop bound is not a fee, and a guard that fires on one gets turned off in a week.
    // The module boundary is what covers the values too small to recognise.
    expect(VALUES).not.toContain('0');
    expect(VALUES).not.toContain('true');
  });
});

describe('findFeeViolations', () => {
  it('finds a fee literal in ledger code, and the live recompute around it', async () => {
    const root = await tree({
      'ledger/services/release.service.ts': 'const fee = applyBps(amount, 150n);\n',
    });
    // Two findings, and both matter: the rate is hard-coded, and computing a fee in ledger code at
    // all means it is not posting from the trade's snapshot.
    await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([
      { file: 'ledger/services/release.service.ts', kind: 'fee-literal', detail: '150' },
      { file: 'ledger/services/release.service.ts', kind: 'fee-read-bypass', detail: 'applyBps' },
    ]);
  });

  it.each([
    ['const min = 30000;', '30000'],
    ['const min = 30_000n;', '30000'],
    ["const v = '2026-10-05.1';", '2026-10-05.1'],
    ['const cap = 50000;', '50000'],
  ])('finds the fee literal in %s', async (code, detail) => {
    const root = await tree({ 'park/services/parcel.service.ts': `${code}\n` });
    await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([{ kind: 'fee-literal', detail }]);
  });

  it('reports the line the literal is on', async () => {
    const root = await tree({ 'merchant/services/payout.service.ts': 'const a = 1;\n\nconst b = 150;\n' });
    await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([{ line: 3 }]);
  });

  it('finds a file reading config/fees.yaml directly', async () => {
    const root = await tree({
      'trades/services/terms.service.ts': "readFileSync('../../../config/fees.yaml');\n",
    });
    // The path also reaches into the config module past its barrel, which is its own finding.
    await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([
      { kind: 'fee-read-bypass', detail: 'config/fees.yaml' },
      { kind: 'fee-read-bypass' },
    ]);
  });

  it.each([
    ["import { getFeeSchedule } from '../../config/fees.js';", 'a deep import past the barrel'],
    ["export { computeTradeFees } from '@komtru/shared-types';", 'a re-export'],
    ["const { snapshotFees } = await import('@komtru/shared-types');", 'a dynamic import'],
    ["readFileSync('config/FEES.YAML');", 'the file named in another case'],
  ])('finds %s (%s)', async (code) => {
    const root = await tree({ 'trades/services/terms.service.ts': `${code}\n` });
    const found = await findFeeViolations(root, VALUES);
    expect(found.map((violation) => violation.kind)).toContain('fee-read-bypass');
  });

  it('finds a rate written as a decimal fraction, which is also a float in a money path', async () => {
    const root = await tree({
      'ledger/services/release.service.ts': 'const protectionFee = Math.round(total * 0.015);\n',
    });
    const found = await findFeeViolations(root, VALUES, ['0.015', '1.5']);
    expect(found).toMatchObject([{ kind: 'fee-literal', detail: '0.015' }]);
  });

  it.each(['const TIMEOUT_MS = 30000;', 'const POLL_INTERVAL = 150;', 'const MAX_ATTEMPTS = 150;'])(
    'leaves %s alone, because a guard that cries wolf gets switched off',
    async (code) => {
      const root = await tree({ 'ledger/services/release.service.ts': `${code}\n` });
      await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
    },
  );

  it.each(['computeTradeFees', 'snapshotFees', 'parseFeeSchedule', 'feeScheduleSchema'])(
    'finds a module importing %s straight from shared-types instead of using the fee module',
    async (symbol) => {
      const root = await tree({
        'trades/services/terms.service.ts': `import { ${symbol} } from '@komtru/shared-types';\n`,
      });
      await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([
        { kind: 'fee-read-bypass', detail: symbol },
      ]);
    },
  );

  it('lets the config module itself hold the values and the imports', async () => {
    const root = await tree({
      'config/fees.ts':
        "import { parseFeeSchedule } from '@komtru/shared-types';\nconst f = '../../../config/fees.yaml';\nconst bps = 150;\n",
    });
    await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
  });

  it('lets a module import the fee module through its barrel', async () => {
    const root = await tree({
      'trades/services/terms.service.ts': "import { snapshotFees } from '../../config/index.js';\n",
    });
    await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
  });

  it('ignores a number that merely contains a fee value', async () => {
    const root = await tree({ 'ledger/services/x.ts': 'const port = 1500;\nconst ms = 300000;\n' });
    await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
  });

  it('ignores a fee-shaped number in a comment, which decides nothing', async () => {
    const root = await tree({ 'ledger/services/x.ts': '// 1.5% is 150 bps today.\nconst a = 1;\n' });
    await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
  });

  it('reports nothing for a tree that does not exist yet', async () => {
    await expect(findFeeViolations(join(tmpdir(), 'komtru-no-such-tree'), VALUES)).resolves.toEqual([]);
  });
});

describe('apps/backend-api/src/modules', () => {
  it('has no fee literal and no fee read outside the config module', async () => {
    const root = resolve(repoRoot, 'apps/backend-api/src/modules');
    // The scan is silent about a root that is not there, so prove it is scanning the real tree,
    // and that the module it exempts is the one that actually exists.
    expect(existsSync(root)).toBe(true);
    expect(existsSync(resolve(root, 'config'))).toBe(true);
    await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
  });
});
