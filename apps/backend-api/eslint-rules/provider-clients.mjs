// ESLint rule: outbound provider calls happen in a job, never in a request.
//
// Design §4.4 puts every external call behind BullMQ so a slow or failing provider cannot hold an HTTP
// request open or block the API's event loop. The structure that makes that checkable: the functions
// that touch the network live in `infrastructure/providers/<provider>.client.ts` and are imported only
// from `jobs/`; everything pure (webhook signature verification, payload parsing, upload signing) lives
// in sibling files that request handlers may use freely.
//
// Paths alone decide this, so a `./x.client.js` specifier that resolves to `x.client.ts` on disk needs
// no filesystem lookup.
import path from 'node:path';

const HTTP_HELPER = path.join('platform', 'providers', 'http');
const stripExtension = (file) => file.replace(/\.(ts|js|mts|mjs)$/, '');
// `paystack.client.ts`, and `paystack/client.ts` for a provider with a folder of its own.
const isClient = (file) => /(^|\.)client$/.test(path.basename(stripExtension(file)));
const isJob = (file) => file.split(path.sep).includes('jobs');
const isPlatform = (file) => file.includes(`${path.sep}src${path.sep}platform${path.sep}`);
const isHttpHelper = (file) => stripExtension(file).endsWith(HTTP_HELPER);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Call providers from jobs only, through a *.client.ts file.' },
    messages: {
      clientOutsideJobs:
        "'{{target}}' calls a provider, so it may be imported only from jobs/. Enqueue a job instead, or move the pure part into its own file.",
      httpOutsideClient:
        "The provider HTTP helper belongs in a '*.client.ts' file under infrastructure/providers/, not in '{{importer}}'.",
    },
    schema: [],
  },
  create(context) {
    const importer = context.filename;

    const check = (node, specifier) => {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
      const target = path.resolve(path.dirname(importer), specifier);
      if (isClient(target) && !isJob(importer)) {
        context.report({ node, messageId: 'clientOutsideJobs', data: { target: specifier } });
        return;
      }
      if (isHttpHelper(target) && !isClient(importer) && !isPlatform(importer)) {
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
    };
  },
};
