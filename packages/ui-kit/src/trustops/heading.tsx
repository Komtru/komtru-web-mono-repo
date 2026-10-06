/**
 * Every TrustOps pattern is a panel inside a page it does not own, so none of them can know which
 * heading level is correct — a `DecisionPanel` is an `h2` on its own and an `h3` inside a
 * `CaseLayout`. The level is a prop, the styling is a class, and the two are independent, which is
 * the only arrangement that keeps `heading-order` passing wherever a panel is dropped.
 */
export type HeadingLevel = 2 | 3 | 4;

export interface HeadingProps {
  level: HeadingLevel;
  className?: string;
  children: React.ReactNode;
}

export function Heading({ level, className, children }: HeadingProps): React.JSX.Element {
  const Tag = `h${String(level)}` as 'h2' | 'h3' | 'h4';
  return <Tag className={className}>{children}</Tag>;
}

/**
 * A stable, render-independent id prefix. The alternative is `useId`, which would make every
 * TrustOps panel a client component — the trade T-012 took for `TextField` and the one this ticket
 * declines, because a decision panel is a read-mostly server surface and its `actions` are already
 * the caller's own client components.
 */
export function slugId(prefix: string, ...parts: string[]): string {
  const slug = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `komtru-${prefix}-${slug === '' ? 'anon' : slug}`;
}
