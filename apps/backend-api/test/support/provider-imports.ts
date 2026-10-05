// A second, deliberately independent check of the rule in eslint-rules/provider-clients.mjs: no file
// outside jobs/ imports a provider client, nothing but a client imports the provider HTTP helper, and no
// module file reaches the network directly. Written against the source text rather than the ESLint
// config, so it is what still fails if the rule is disabled, renamed or dropped from the config.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ClientImportViolation {
  /** Path relative to the scanned root. */
  file: string;
  specifier: string;
  kind: 'client-outside-jobs' | 'http-outside-client' | 'raw-network-call' | 'jobs-outside-jobs';
}

/** `from '…'`, `import('…')` and the side-effect form `import '…'`. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const BARE_FETCH = /(?<![\w.$])fetch\s*\(/;
const RAW_HTTP_MODULES = new Set(['node:http', 'node:https', 'http', 'https', 'undici', 'axios']);
const HTTP_HELPER = path.join('platform', 'providers', 'http');
const stripExtension = (file: string) => file.replace(/\.(ts|js|mts|mjs)$/, '');
/** `paystack.client.ts`, and `paystack/client.ts` for a provider with a folder of its own. */
const isClient = (file: string) => /(^|\.)client$/.test(path.basename(stripExtension(file)));
const INDEX_FILES = new Set(['index.ts', 'index.js']);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

/** Walks a module tree (`src/modules`) and reports every forbidden provider call or import. */
export async function findProviderImportViolations(root: string): Promise<ClientImportViolation[]> {
  const violations: ClientImportViolation[] = [];

  for await (const file of walk(root)) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    const segments = relative.split(path.sep);
    const inJobs = segments.includes('jobs');
    const client = isClient(file);
    /** `<module>/index.ts`: the module's own surface, which wires its jobs' dependencies at start. */
    const moduleIndex = segments.length === 2 && INDEX_FILES.has(segments[1] ?? '');

    if (!client && BARE_FETCH.test(source)) {
      violations.push({ file: relative, specifier: 'fetch()', kind: 'raw-network-call' });
    }

    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (specifier === undefined) continue;
      const common = { file: relative, specifier };
      if (RAW_HTTP_MODULES.has(specifier)) {
        if (!client) violations.push({ ...common, kind: 'raw-network-call' });
        continue;
      }
      if (!specifier.startsWith('.')) continue;

      const target = path.resolve(path.dirname(file), specifier);
      if (isClient(target) && !inJobs && !client) {
        violations.push({ ...common, kind: 'client-outside-jobs' });
      } else if (stripExtension(target).endsWith(HTTP_HELPER) && !client) {
        violations.push({ ...common, kind: 'http-outside-client' });
      } else if (
        // A file in jobs/ may import a client, so importing that file is a second route to the
        // provider. Only jobs/ and the module's index.ts may take it.
        path.relative(root, target).split(path.sep).includes('jobs') &&
        !inJobs &&
        !moduleIndex
      ) {
        violations.push({ ...common, kind: 'jobs-outside-jobs' });
      }
    }
  }
  return violations;
}
