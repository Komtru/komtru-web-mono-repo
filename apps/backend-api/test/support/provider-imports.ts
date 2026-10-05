// A second, deliberately independent check of the rule in eslint-rules/provider-clients.mjs: no file
// outside jobs/ imports a provider client, and nothing but a client imports the provider HTTP helper.
// Written against the source text rather than the ESLint config, so it is what still fails if the rule
// is disabled, renamed or dropped from the config.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ClientImportViolation {
  /** Path relative to the scanned root. */
  file: string;
  specifier: string;
  kind: 'client-outside-jobs' | 'http-outside-client';
}

const SPECIFIER = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]*)['"]/g;
const HTTP_HELPER = path.join('platform', 'providers', 'http');
const stripExtension = (file: string) => file.replace(/\.(ts|js|mts|mjs)$/, '');
// `paystack.client.ts`, and `paystack/client.ts` for a provider with a folder of its own.
const isClient = (file: string) => /(^|\.)client$/.test(path.basename(stripExtension(file)));

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

/** Walks a module tree (`src/modules`) and reports every forbidden provider import. */
export async function findProviderImportViolations(root: string): Promise<ClientImportViolation[]> {
  const violations: ClientImportViolation[] = [];

  for await (const file of walk(root)) {
    const source = await readFile(file, 'utf8');
    const inJobs = path.relative(root, file).split(path.sep).includes('jobs');

    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (specifier === undefined) continue;
      const target = path.resolve(path.dirname(file), specifier);
      const common = { file: path.relative(root, file), specifier };
      if (isClient(target) && !inJobs) {
        violations.push({ ...common, kind: 'client-outside-jobs' });
      } else if (stripExtension(target).endsWith(HTTP_HELPER) && !isClient(file)) {
        violations.push({ ...common, kind: 'http-outside-client' });
      }
    }
  }
  return violations;
}
