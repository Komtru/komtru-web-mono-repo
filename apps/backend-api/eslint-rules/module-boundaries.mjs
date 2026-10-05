// ESLint rule: code may reach into src/modules/<name>/ only through that module's index file.
//
// Each module owns its schema, services and domain logic (design §4.2). Importing another module's
// internals couples two modules invisibly; going through index.ts keeps the public surface explicit.
import path from 'node:path';

const MODULES_SEGMENT = `${path.sep}src${path.sep}modules${path.sep}`;
const INDEX_FILES = new Set(['index.js', 'index.ts', 'index']);

/**
 * `/…/src/modules/trades/services/a.ts` → { module: 'trades', rest: 'services/a.ts' }.
 * Returns null outside src/modules, and for files directly in src/modules (the registry, index.ts),
 * which belong to no module.
 */
function locate(file) {
  const at = file.lastIndexOf(MODULES_SEGMENT);
  if (at === -1) return null;
  const [module, ...rest] = file.slice(at + MODULES_SEGMENT.length).split(path.sep);
  if (rest.length === 0) return null;
  return { module, rest: rest.join('/') };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Import another module only through its index file.' },
    messages: {
      crossModule:
        "Import '{{target}}' through its public surface ('{{module}}/index.js'), not its internals.",
    },
    schema: [],
  },
  create(context) {
    const importer = locate(context.filename);

    const check = (node, specifier) => {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
      const resolved = path.resolve(path.dirname(context.filename), specifier);
      const target = locate(resolved);
      if (!target || !target.module) return;
      if (importer && importer.module === target.module) return;
      if (INDEX_FILES.has(target.rest)) return;
      context.report({ node, messageId: 'crossModule', data: { target: specifier, module: target.module } });
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
