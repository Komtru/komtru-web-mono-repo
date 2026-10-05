// komtru/no-raw-hex: every colour in the product is one of the 52 custom properties the design
// reference declares, published as Tailwind utilities by `@komtru/config/tailwind/preset.css`. A hex
// literal in app code is a colour nobody signed off on, and it is invisible to a token change.
//
// Only string literals and template chunks are checked, which is where a colour reaches JSX:
// `style={{ color: '#fff' }}`, a Tailwind arbitrary value `bg-[#4552D6]`, an inline SVG attribute.
// A string containing `://` is skipped: a URL fragment (`/docs#abc123`) is the one realistic shape
// that looks like a colour and is not one.

const HEX = /(?<![\w/])#([0-9a-fA-F]+)(?!\w)/g;
const COLOUR_LENGTHS = new Set([3, 4, 6, 8]);

/** @param {string} text @returns {string[]} */
function rawHexColours(text) {
  if (text.includes('://')) return [];
  const found = [];
  for (const match of text.matchAll(HEX)) {
    if (COLOUR_LENGTHS.has(match[1].length)) found.push(match[0]);
  }
  return found;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Use a design token instead of a raw hex colour.' },
    messages: {
      rawHex: "Use a design token ('bg-trust-indigo', var(--trust-indigo)), not the raw colour '{{hex}}'.",
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allow = new Set(
      (context.options[0]?.allow ?? []).map((/** @type {string} */ hex) => hex.toLowerCase()),
    );

    const check = (node, text) => {
      if (typeof text !== 'string') return;
      for (const hex of rawHexColours(text)) {
        if (allow.has(hex.toLowerCase())) continue;
        context.report({ node, messageId: 'rawHex', data: { hex } });
      }
    };

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
};
