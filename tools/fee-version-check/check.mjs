// Design §6.5: "A CI check compares against `main` and fails if any value changed without a version
// bump." Git history is the audit trail for a fee change, which only works if the version in the
// file moves whenever a value does.
//
// Pure, so it is testable without git; tools/fee-version-check/cli.mjs is the only part that shells
// out to read the base revision.
import { parse } from 'yaml';

export const FEES_FILE = 'config/fees.yaml';

/** `2026-10-05.1`. A version that does not look like this is already rejected by the zod schema. */
const VERSION = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

/** Every scalar leaf as `dotted.key` -> rendered value, so added and removed keys both show up. */
function flatten(value, prefix = '', into = new Map()) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
  } else {
    into.set(prefix, JSON.stringify(value) ?? 'undefined');
  }
  return into;
}

/** -1, 0 or 1. The date part orders lexically (it is zero-padded); the counter numerically. */
function compareVersions(a, b) {
  const left = VERSION.exec(a);
  const right = VERSION.exec(b);
  if (!left || !right) return a === b ? 0 : NaN;
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
  return Number(left[2]) === Number(right[2]) ? 0 : Number(left[2]) < Number(right[2]) ? -1 : 1;
}

/**
 * @param {string | null} baseText the file on the base ref, or null when it is not there yet
 * @param {string} headText the file on this branch
 * @returns {string[]} one problem per offending key; empty when the change is safe
 */
export function findVersionProblems(baseText, headText) {
  let head;
  try {
    head = parse(headText);
  } catch {
    return [`${FEES_FILE} is not valid YAML`];
  }
  if (baseText === null) return [];

  let base;
  try {
    base = parse(baseText);
  } catch {
    // The base ref is already merged; a broken file there is not this branch's problem to report.
    return [];
  }

  const order = compareVersions(String(base?.version), String(head?.version));
  if (order === 1) {
    return [`${FEES_FILE} version went backwards: ${base?.version} -> ${head?.version}`];
  }

  const before = flatten(base);
  const after = flatten(head);
  before.delete('version');
  after.delete('version');

  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .sort();
  if (changed.length === 0 || order === -1) return [];

  return changed.map(
    (key) =>
      `${FEES_FILE}: ${key} changed but version was not bumped (still ${head?.version}). ` +
      'Bump it, or the change has no audit trail. See docs/runbooks/fees.md.',
  );
}
