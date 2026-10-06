/**
 * Joins class names, dropping anything falsy. Six lines rather than a `clsx` dependency: a primitive
 * composes at most a handful of conditional utilities.
 *
 * **It appends; it does not override.** Two utilities setting the same property are resolved by
 * where their rules sit in the stylesheet, not by the order they are written here, so
 * `<Card className="rounded-[10px]">` keeps `rounded-md` as often as not. To change a property a
 * primitive already sets, give the primitive a prop for it rather than a `className` — and inside a
 * primitive, write one branch per property rather than a base plus an override.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
