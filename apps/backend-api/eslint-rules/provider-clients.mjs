// ESLint rule: outbound provider calls happen in a job, never in a request.
//
// Design §4.4 puts every external call behind BullMQ so a slow or failing provider cannot hold an HTTP
// request open or block the API's event loop. The structure that makes that checkable: the functions
// that touch the network live in `infrastructure/providers/<provider>.client.ts` (or `<provider>/client.ts`)
// and are imported only from `jobs/`; everything pure — webhook signature verification, payload parsing,
// upload signing — lives in sibling files that request handlers may use freely.
//
// Paths alone decide this, so a `./x.client.js` specifier that resolves to `x.client.ts` on disk needs
// no filesystem lookup.
import path from 'node:path';

const MODULES_SEGMENT = `${path.sep}src${path.sep}modules${path.sep}`;
const PLATFORM_PROVIDERS = `${path.sep}src${path.sep}platform${path.sep}providers${path.sep}`;
const HTTP_HELPER = path.join('platform', 'providers', 'http');
const RAW_HTTP_MODULES = new Set(['node:http', 'node:https', 'http', 'https', 'undici', 'axios']);

const stripExtension = (file) => file.replace(/\.(ts|js|mts|mjs)$/, '');
/** `paystack.client.ts`, and `paystack/client.ts` for a provider with a folder of its own. */
const isClient = (file) => /(^|\.)client$/.test(path.basename(stripExtension(file)));
const isHttpHelper = (file) => stripExtension(file).endsWith(HTTP_HELPER);
const isPlatformProvider = (file) => file.includes(PLATFORM_PROVIDERS);

/** `/…/src/modules/ledger/jobs/x.ts` → `ledger/jobs/x.ts`, and null outside src/modules. */
function withinModules(file) {
  const at = file.lastIndexOf(MODULES_SEGMENT);
  return at === -1 ? null : file.slice(at + MODULES_SEGMENT.length);
}

/** Anchored on src/modules, so a checkout under a directory named `jobs` does not disable the rule. */
const isJob = (file) => (withinModules(file) ?? '').split(path.sep).includes('jobs');

/** `ledger/index.ts` — the module's own surface, which assembles its jobs' dependencies at start. */
const isModuleIndex = (file) => {
  const parts = (withinModules(file) ?? '').split(path.sep);
  return parts.length === 2 && INDEX_FILES.has(parts[1]);
};

// A module's composition root: `index.ts`, or `module.ts` where a module keeps its wiring separate
// from its barrel and re-exports it. Top level of the module only — see provider-imports.ts.
const INDEX_FILES = new Set(['index.ts', 'index.js', 'module.ts', 'module.js']);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Call providers from jobs only, through a *.client.ts file.' },
    messages: {
      jobsOutsideJobs:
        "'{{target}}' lives in jobs/, so it may be imported only from jobs/ or the module's index.ts. A file there can hand out a provider client, which is the boundary this rule exists to hold.",
      clientOutsideJobs:
        "'{{target}}' calls a provider, so it may be imported only from jobs/. Enqueue a job instead, or move the pure part into its own file.",
      httpOutsideClient:
        "The provider HTTP helper belongs in a '*.client.ts' file under infrastructure/providers/, not in '{{importer}}'.",
      rawNetworkCall:
        "Reach a provider through providerRequest() in a '*.client.ts' file, not with {{what}} here.",
    },
    schema: [],
  },
  create(context) {
    const importer = context.filename;
    // Only module code is held to this: the platform owns the helper, and src/server.ts owns the server.
    const inModule = withinModules(importer) !== null;

    const check = (node, specifier) => {
      if (typeof specifier !== 'string') return;
      if (RAW_HTTP_MODULES.has(specifier)) {
        if (inModule && !isClient(importer)) {
          context.report({ node, messageId: 'rawNetworkCall', data: { what: `'${specifier}'` } });
        }
        return;
      }
      if (!specifier.startsWith('.')) return;

      const target = path.resolve(path.dirname(importer), specifier);
      if (isClient(target) && !isJob(importer) && !isClient(importer)) {
        context.report({ node, messageId: 'clientOutsideJobs', data: { target: specifier } });
        return;
      }
      // A file in jobs/ may legitimately import a client, so importing THAT file is a second way to
      // reach the provider. Only jobs/ and the module's index.ts (which wires a job's dependencies at
      // start) may do it; a service or controller reaching in would call the provider synchronously.
      if (isJob(target) && !isJob(importer) && !isModuleIndex(importer)) {
        context.report({ node, messageId: 'jobsOutsideJobs', data: { target: specifier } });
        return;
      }
      if (isHttpHelper(target) && !isClient(importer) && !isPlatformProvider(importer)) {
        context.report({
          node,
          messageId: 'httpOutsideClient',
          data: { importer: path.basename(importer) },
        });
      }
    };

    const fromSource = (node) => check(node, node.source?.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
      // The import boundary says nothing about a bare `fetch(...)`, which is the easier accident.
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'fetch') return;
        if (!inModule || isClient(importer)) return;
        context.report({ node, messageId: 'rawNetworkCall', data: { what: 'fetch()' } });
      },
    };
  },
};
