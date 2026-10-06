import { cx } from '../primitives/cx.js';
import { Heading, type HeadingLevel } from './heading.js';

/**
 * `.timeline` — the elevated card the reference puts every left-hand case panel inside, used for
 * "What we know" (N2), "Evidence matrix" (TO-PA2) and the case timeline. Deliberately not exported
 * from the package: it is the chrome `EvidenceMatrix`, `Timeline` and `TrustTrail` share, not a
 * component a screen should reach for — a screen that wants a plain card wants T-012's `<Card>`.
 */
export interface CasePanelProps {
  heading: string;
  headingLevel: HeadingLevel;
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function CasePanel({
  heading,
  headingLevel,
  children,
  className,
  ...rest
}: CasePanelProps): React.JSX.Element {
  return (
    <section
      {...rest}
      aria-label={rest['aria-label'] ?? heading}
      className={cx(
        'rounded-lg border border-solid border-border-hairline bg-surface-elevated p-[20px]',
        className,
      )}
    >
      <Heading level={headingLevel} className="mb-[16px] text-[14px] font-semibold">
        {heading}
      </Heading>
      {children}
    </section>
  );
}
