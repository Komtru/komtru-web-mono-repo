import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN,
  MONEY_TREES,
  findForbiddenPaystackPrimitives,
} from '../../support/forbidden-primitives.js';

// Assembled, not written out, so this test is not itself a finding of the guard it exercises.
const { sub: SUB, split: SPLIT, dedicated: DEDICATED } = FORBIDDEN;

let tree: string | undefined;
afterEach(async () => {
  if (tree) await rm(tree, { recursive: true, force: true });
  tree = undefined;
});

const sources = async (files: Record<string, string>): Promise<string> => {
  tree = await mkdtemp(join(tmpdir(), 'komtru-forbidden-'));
  for (const [file, source] of Object.entries(files)) {
    const full = join(tree, file);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, source, 'utf8');
  }
  return tree;
};

describe('findForbiddenPaystackPrimitives', () => {
  it(`reports a ${SUB} on a charge`, async () => {
    const root = await sources({
      'a.ts': `const body = { amount: 1, ${SUB}: 'ACCT_x1y2' };\n`,
    });

    await expect(findForbiddenPaystackPrimitives(root)).resolves.toEqual([
      { file: 'a.ts', line: 1, primitive: SUB },
    ]);
  });

  it(`reports a ${SPLIT} code, a transaction ${SPLIT} and the ${SPLIT} endpoint`, async () => {
    const root = await sources({
      'code.ts': `const body = { ${SPLIT}_code: 'SPL_x' };\n`,
      'name.ts': `type Transaction_${SPLIT} = { id: string };\n`,
      'endpoint.ts': `await call('/${SPLIT}');\n`,
    });

    const findings = await findForbiddenPaystackPrimitives(root);

    expect(findings.map((f) => f.file).sort()).toEqual(['code.ts', 'endpoint.ts', 'name.ts']);
    expect(new Set(findings.map((f) => f.primitive))).toEqual(new Set([SPLIT]));
  });

  it('reports the third primitive in every spelling, including its abbreviation', async () => {
    const root = await sources({
      'snake.ts': `const path = '/${DEDICATED}_account';\n`,
      'words.ts': `// a ${DEDICATED} virtual account per trade\n`,
      'abbreviation.ts': `const ${FORBIDDEN.abbreviation}_ENABLED = true;\n`,
    });

    const findings = await findForbiddenPaystackPrimitives(root);

    expect(findings.map((f) => f.file).sort()).toEqual(['abbreviation.ts', 'snake.ts', 'words.ts']);
    expect(new Set(findings.map((f) => f.primitive))).toEqual(new Set([DEDICATED]));
  });

  it('scans the config files a source-only scan would walk past', async () => {
    const root = await sources({
      'docker-compose.yml': `    environment:\n      PAYSTACK_${SUB.toUpperCase()}_CODE: ACCT_x\n`,
      '.env.example': `PAYSTACK_${SUB.toUpperCase()}_CODE=\n`,
      'migrations/0001_init.sql': `alter table charges add column ${SUB}_code text;\n`,
      'scripts/seed.sh': `curl -d "${SUB}=ACCT_x" https://api.paystack.co/transaction/initialize\n`,
    });

    const findings = await findForbiddenPaystackPrimitives(root);

    expect(findings.map((f) => f.file).sort()).toEqual([
      '.env.example',
      'docker-compose.yml',
      'migrations/0001_init.sql',
      'scripts/seed.sh',
    ]);
  });

  it(`reports the SDK-shaped ${SPLIT} spellings, not just the parameter names`, async () => {
    const cap = `${SPLIT[0]?.toUpperCase() ?? ''}${SPLIT.slice(1)}`;
    const root = await sources({
      'create.ts': `await paystack.create${cap}({ type: 'percentage' });\n`,
      'accessor.ts': `await paystack.${SPLIT}s.list();\n`,
      'type.ts': `interface ${cap}Group { id: string }\n`,
    });

    expect((await findForbiddenPaystackPrimitives(root)).map((f) => f.file).sort()).toEqual([
      'accessor.ts',
      'create.ts',
      'type.ts',
    ]);
  });

  it('reports the third primitive in lower and camel case, not only shouted', async () => {
    const abbr = FORBIDDEN.abbreviation;
    const root = await sources({
      'snake.ts': `const ${abbr.toLowerCase()}_enabled = true;\n`,
      'camel.ts': `const ${abbr.toLowerCase()}Service = makeService();\n`,
      'suffix.ts': `const use${abbr[0]}${abbr.slice(1).toLowerCase()} = () => null;\n`,
    });

    expect((await findForbiddenPaystackPrimitives(root)).map((f) => f.file).sort()).toEqual([
      'camel.ts',
      'snake.ts',
      'suffix.ts',
    ]);
  });

  it('reports nothing for ordinary code that happens to use the word', async () => {
    // A guard that cries wolf gets switched off; these must stay silent.
    const root = await sources({
      'paths.ts': "const parts = file.split(path.sep);\nconst [head] = name.split('.');\n",
      'copy.tsx': "export const label = 'Split the bill with a friend';\n",
      'why.ts': '// Transaction splitting is forbidden here; see m8.\n',
      'words.ts': 'const divan = 1;\nconst individual = 2;\nconst advance = 3;\n',
      'notes.md': `we must never use a ${SUB} or a ${DEDICATED} virtual account\n`,
    });

    await expect(findForbiddenPaystackPrimitives(root)).resolves.toEqual([]);
  });

  it('skips the directories a repository scan must not walk', async () => {
    const root = await sources({
      'node_modules/paystack/index.js': `exports.${SUB} = 1;\n`,
      'dist/bundle.js': `const ${SUB} = 1;\n`,
    });

    await expect(findForbiddenPaystackPrimitives(root)).resolves.toEqual([]);
    // An explicit budget, because this is the one case whose cost is the repository's size rather
    // than its own: ~400ms alone, but it runs beside 200 other workers and every agent's suite, and
    // Vitest's 5s default turned that contention into a failure that reads as a real finding.
  }, 60_000);
});

describe('the repository', () => {
  const root = resolve(import.meta.dirname, '../../../../..');

  /*
   * The scan is silent about a directory that is not there, so a typo in MONEY_TREES would not fail
   * — it would walk nothing and report a clean repository. That is the one way this guard can be
   * switched off by accident now that it has a scope, so the scope is checked before it is trusted.
   */
  it('scopes itself to trees that are actually there', () => {
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true);
    for (const tree of MONEY_TREES) {
      expect(existsSync(join(root, tree)), `MONEY_TREES names ${tree}, which does not exist`).toBe(true);
    }
  });

  /*
   * Every tree that can initiate a charge has to be in scope, or the guard has a blind spot exactly
   * where the next forbidden primitive would be written. `web-app-ui` is the case that matters: it
   * is a frontend, and it opens Paystack Inline.
   *
   * The signal is the provider's API surface in this repository — the Inline port and the checkout
   * that drives it — and deliberately not the word "Paystack", which also appears as a partner name
   * in marketing copy, in the secret scanners' prose and in env fixtures. None of those can pay
   * anyone, and scoping the guard to them would put back the whole-repository walk this replaced.
   */
  it('covers every tree that can reach the provider', async () => {
    const covered = (file: string): boolean =>
      MONEY_TREES.some((tree) => file === tree || file.startsWith(`${tree}/`));
    const { stdout } = await promisify(execFile)(
      'git',
      [
        'grep',
        '-rlE',
        'PaystackInline|paystackCheckout',
        '--',
        'apps',
        'packages',
        'config',
        'tools',
        'scripts',
      ],
      { cwd: root },
    );

    const matched = stdout.split('\n').filter(Boolean);
    // An empty result would pass this vacuously, and the surface it looks for does exist.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.filter((file) => !covered(file))).toEqual([]);
  }, 60_000);

  it('uses none of the three primitives m8 §1 forbids', async () => {
    await expect(findForbiddenPaystackPrimitives(root, MONEY_TREES)).resolves.toEqual([]);
    // The same explicit budget, and for a stronger version of the reason given above: this case
    // walks the REAL repository rather than a fixture, so it is the most expensive scan in the
    // suite, and it was the only one left on Vitest's 5s default. Alone it takes under a second;
    // under `turbo run test`, with the web suite's workers running beside it, it timed out and read
    // as a real finding (F-081).
  }, 60_000);
});
