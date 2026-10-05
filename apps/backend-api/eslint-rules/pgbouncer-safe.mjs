// komtru/pgbouncer-safe: PgBouncer runs in transaction mode, so consecutive statements may land on
// different server connections. Anything that relies on session state breaks silently there:
// LISTEN/UNLISTEN, session advisory locks, PREPARE/DEALLOCATE, and named prepared statements.
// Transaction-scoped advisory locks (pg_advisory_xact_lock) are fine. Session-level SET is not
// checked: text alone cannot tell it from UPDATE ... SET, so code review covers it.

// SQL keywords are matched in upper case only (the codebase's SQL style), so prose like "listen"
// in a log message never trips the rule. Function names are matched in any case.
const SESSION_SQL = [
  /\b(UN)?LISTEN\b/,
  /\bPREPARE\b/,
  /\bDEALLOCATE\b/,
  /\bpg_(try_)?advisory_lock(_shared)?\b/i,
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow SQL that depends on session state, which transaction pooling loses' },
    schema: [],
    messages: {
      sessionSql:
        'Session-level SQL ({{match}}) breaks behind PgBouncer transaction pooling. Use a transaction-scoped alternative (e.g. pg_advisory_xact_lock).',
      namedStatement:
        'Named prepared statements break behind PgBouncer transaction pooling. Use an unnamed query.',
    },
  },
  create(context) {
    const check = (node, text) => {
      for (const pattern of SESSION_SQL) {
        const match = pattern.exec(text);
        if (match) {
          context.report({ node, messageId: 'sessionSql', data: { match: match[0] } });
          return;
        }
      }
    };
    const isMethodCall = (node, name) =>
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === name;

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' '));
      },
      CallExpression(node) {
        // drizzle: query.prepare('name')
        if (isMethodCall(node, 'prepare') && node.arguments.length > 0) {
          context.report({ node, messageId: 'namedStatement' });
        }
        // pg: pool.query({ name: 'x', text: '...' })
        const [first] = node.arguments;
        if (
          isMethodCall(node, 'query') &&
          first?.type === 'ObjectExpression' &&
          first.properties.some(
            (p) =>
              p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'name',
          )
        ) {
          context.report({ node, messageId: 'namedStatement' });
        }
      },
    };
  },
};
