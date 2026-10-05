/**
 * Joins class names, dropping anything falsy. Six lines rather than a `clsx` dependency: a primitive
 * composes at most a handful of conditional utilities.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
