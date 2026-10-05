import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FORBIDDEN, findForbiddenPaystackPrimitives } from '../../support/forbidden-primitives.js';

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

  it('reports nothing for ordinary code that happens to use the word', async () => {
    // A guard that cries wolf gets switched off; these must stay silent.
    const root = await sources({
      'paths.ts': "const parts = file.split(path.sep);\nconst [head] = name.split('.');\n",
      'copy.tsx': "export const label = 'Split the bill with a friend';\n",
      'why.ts': '// Transaction splitting is forbidden here; see m8.\n',
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
  });
});

describe('the repository', () => {
  it('uses none of the three primitives m8 §1 forbids', async () => {
    const root = resolve(import.meta.dirname, '../../../../..');
    // The scan is silent about a root that is not there, so prove it is scanning the real tree.
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true);

    await expect(findForbiddenPaystackPrimitives(root)).resolves.toEqual([]);
  });
});
