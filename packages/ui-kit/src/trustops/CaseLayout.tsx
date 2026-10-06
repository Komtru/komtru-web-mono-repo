import { cx } from '../primitives/cx.js';
import { Heading, type HeadingLevel } from './heading.js';

export interface CaseLayoutProps {
  /** `.case-id` — "KMT-90138 · Proposed 8 minutes ago". Set in mono; it gets quoted and pasted. */
  caseId: string;
  /** What the case is about, in a reviewer's words. Names the section. */
  subject: string;
  /** `.case-parties` — who is on each side, and for how much. */
  parties?: string;
  /** The risk chip or lifecycle state. */
  status?: React.ReactNode;
  /** Take case, reassign, escalate. */
  ownerActions?: React.ReactNode;
  /** The left column: what is known. */
  evidence: React.ReactNode;
  /** The right column: what is to be done about it. */
  decision: React.ReactNode;
  headingLevel?: HeadingLevel;
  className?: string;
}

/**
 * `.case-header` + `.case-layout` — the shell every TrustOps case screen shares: identity and risk
 * at the top, evidence left, decision right (N2, Z6, PH7, TO-PA2, AC9b, AC10).
 *
 * Evidence precedes the decision in the DOM, not only on screen. It is the same argument as the
 * advisory separation inside `DecisionPanel`: a reviewer should meet what is known before meeting
 * the buttons, and on a narrow viewport, where the two columns stack, that is the only ordering
 * that survives.
 *
 * The case header is a `<div>`, not a `<header>`. HTML-AAM maps a `<header>` scoped inside a
 * sectioning element to `generic`, so the two are equivalent by spec — but only by spec: Testing
 * Library's role resolution still reports a scoped `<header>` as `banner`, and an ops console has
 * exactly one banner, the app shell's. A case header that any tool might read as a second one is
 * not worth the expressiveness, and T-013's shell is the thing that owns the real banner.
 */
export function CaseLayout({
  caseId,
  subject,
  parties,
  status,
  ownerActions,
  evidence,
  decision,
  headingLevel = 2,
  className,
}: CaseLayoutProps): React.JSX.Element {
  return (
    <section aria-label={subject} className={className}>
      <div className="mb-[20px] flex flex-wrap items-start justify-between gap-[14px] rounded-lg border border-solid border-border-hairline bg-surface-elevated p-[20px]">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-trust-gray">{caseId}</p>
          <Heading level={headingLevel} className="mx-[0px] my-[4px] text-[17px] font-semibold">
            {subject}
          </Heading>
          {parties !== undefined && <p className="text-[13px] text-slate">{parties}</p>}
        </div>
        {(status !== undefined || ownerActions !== undefined) && (
          <div className="flex flex-wrap items-center gap-[10px]">
            {status}
            {ownerActions}
          </div>
        )}
      </div>

      <div
        className={cx(
          // The reference draws the desktop console only. One column below `md` is this package's
          // addition, and the only one the layout makes.
          'grid grid-cols-1 gap-[20px] md:grid-cols-[1.3fr_1fr]',
        )}
      >
        <div className="min-w-0">{evidence}</div>
        <div className="min-w-0">{decision}</div>
      </div>
    </section>
  );
}
