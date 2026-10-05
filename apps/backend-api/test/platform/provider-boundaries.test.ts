import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findProviderImportViolations } from '../support/provider-imports.js';

let tree: string | undefined;
afterEach(async () => {
  if (tree) await rm(tree, { recursive: true, force: true });
  tree = undefined;
});

/** Writes `files` (path relative to the modules root) into a throwaway modules tree. */
const modules = async (files: Record<string, string>): Promise<string> => {
  tree = await mkdtemp(join(tmpdir(), 'komtru-providers-'));
  for (const [file, source] of Object.entries(files)) {
    const full = join(tree, file);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, source, 'utf8');
  }
  return tree;
};

const CLIENT = 'ledger/infrastructure/providers/paystack.client.ts';
const HELPER = 'ledger/infrastructure/providers/paystack.signature.ts';

describe('findProviderImportViolations', () => {
  it('finds a provider client imported from a service and from an http controller', async () => {
    const root = await modules({
      [CLIENT]: 'export const verifyCharge = async () => undefined;\n',
      'ledger/services/funding.service.ts':
        "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';\n",
      'ledger/http/controllers.ts':
        "export { verifyCharge } from '../infrastructure/providers/paystack.client.js';\n",
    });

    const violations = await findProviderImportViolations(root);

    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.file).sort()).toEqual([
      'ledger/http/controllers.ts',
      'ledger/services/funding.service.ts',
    ]);
    expect(new Set(violations.map((v) => v.kind))).toEqual(new Set(['client-outside-jobs']));
  });

  it('accepts a client imported from jobs/ and a pure helper imported from http/', async () => {
    const root = await modules({
      [CLIENT]: 'export const verifyCharge = async () => undefined;\n',
      [HELPER]: 'export const verify = () => true;\n',
      'ledger/jobs/verify-charge.job.ts':
        "import { verifyCharge } from '../infrastructure/providers/paystack.client.js';\n",
      'ledger/http/controllers.ts':
        "import { verify } from '../infrastructure/providers/paystack.signature.js';\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toEqual([]);
  });

  it('finds a file reaching past its client straight to the platform http helper', async () => {
    const root = await modules({
      'ledger/services/funding.service.ts':
        "import { providerRequest } from '../../../platform/providers/http.js';\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toEqual([
      {
        file: 'ledger/services/funding.service.ts',
        specifier: '../../../platform/providers/http.js',
        kind: 'http-outside-client',
      },
    ]);
  });

  it('finds a client named client.ts inside a provider folder', async () => {
    const root = await modules({
      'ledger/infrastructure/providers/paystack/client.ts': 'export const charge = async () => undefined;\n',
      'ledger/jobs/charge.job.ts':
        "import { charge } from '../infrastructure/providers/paystack/client.js';\n",
      'ledger/services/funding.service.ts':
        "import { charge } from '../infrastructure/providers/paystack/client.js';\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toMatchObject([
      { file: 'ledger/services/funding.service.ts', kind: 'client-outside-jobs' },
    ]);
  });

  it('finds a dynamic import of a client', async () => {
    const root = await modules({
      [CLIENT]: 'export const verifyCharge = async () => undefined;\n',
      'ledger/http/controllers.ts':
        "const c = await import('../infrastructure/providers/paystack.client.js');\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toMatchObject([
      { kind: 'client-outside-jobs' },
    ]);
  });

  it('finds a bare fetch and a raw http client outside a provider client', async () => {
    const root = await modules({
      'ledger/http/controllers.ts': "const r = await fetch('https://api.paystack.co/x');\n",
      'ledger/jobs/charge.job.ts': "import https from 'node:https';\n",
      'ledger/infrastructure/providers/paystack.client.ts': "const r = await fetch('https://x.test');\n",
    });

    const violations = await findProviderImportViolations(root);

    expect(violations.map((v) => v.file).sort()).toEqual([
      'ledger/http/controllers.ts',
      'ledger/jobs/charge.job.ts',
    ]);
    expect(new Set(violations.map((v) => v.kind))).toEqual(new Set(['raw-network-call']));
  });

  it('finds a side-effect import of a client', async () => {
    const root = await modules({
      'ledger/infrastructure/providers/paystack.client.ts': 'export const charge = 1;\n',
      'ledger/http/controllers.ts': "import '../infrastructure/providers/paystack.client.js';\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toMatchObject([
      { kind: 'client-outside-jobs' },
    ]);
  });

  it('lets a client import a sibling client', async () => {
    const root = await modules({
      'ledger/infrastructure/providers/paystack/base.client.ts': 'export const call = 1;\n',
      'ledger/infrastructure/providers/paystack/charge.client.ts':
        "import { call } from './base.client.js';\n",
    });

    await expect(findProviderImportViolations(root)).resolves.toEqual([]);
  });

  it('reports nothing for a tree that does not exist yet', async () => {
    await expect(findProviderImportViolations(join(tmpdir(), 'komtru-no-such-tree'))).resolves.toEqual([]);
  });
});

describe('src/modules', () => {
  it('has no http/ or services/ file importing a provider client', async () => {
    const root = resolve(import.meta.dirname, '../../src/modules');
    // The scan is silent about a root that is not there, so prove it is scanning the real tree.
    expect(existsSync(root)).toBe(true);
    await expect(findProviderImportViolations(root)).resolves.toEqual([]);
  });
});
