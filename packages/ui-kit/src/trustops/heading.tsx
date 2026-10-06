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
