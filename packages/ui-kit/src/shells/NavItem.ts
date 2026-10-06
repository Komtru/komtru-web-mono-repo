/**
 * One destination in any of the four navigations — bottom tab bar, consumer sidebar, tablet top nav
 * and the ops rail. They differ in how they draw a destination, never in what one is.
 */
export interface NavItem {
  label: string;
  /** Inherits the item's colour through `currentColor`, so a screen's icon needs no state of its own. */
  icon?: React.ReactNode;
  /** Given, the destination is a link; omitted, it is a button and `onSelect` does the work. */
  href?: string;
  current?: boolean;
  onSelect?: () => void;
}

/**
 * The index of the destination the person is on, or `undefined` when they are on none of them.
 *
 * Throws rather than picking: two destinations marked current means two `aria-current="page"`s, and
 * a screen reader announces both. The reference never draws it, so it is a caller's mistake — and a
 * silent one, because the second indigo pill looks deliberate.
 */
export function soleCurrent(items: readonly NavItem[], where: string): number | undefined {
  const marked = items.flatMap((item, index) => (item.current === true ? [index] : []));
  if (marked.length > 1) {
    const names = marked.map((index) => items[index]?.label).join(', ');
    throw new RangeError(`${where}: ${names} are all marked current; a person is on one page at a time`);
  }
  return marked[0];
}
