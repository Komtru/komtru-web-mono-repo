import { Children } from 'react';
import { AdvisoryBox } from './AdvisoryBox.js';
import { Heading, type HeadingLevel, slugId } from './heading.js';
import { PolicyCite, type PolicyCiteProps } from './PolicyCite.js';

/** The reference's `.human-decides` copy, drawn under every advisory in the document. */
export const HUMAN_DECIDES = 'a human decides, always';

export interface DecisionPanelProps {
  heading?: string;
  headingLevel?: HeadingLevel;
  /** Prose only — see `AdvisoryBox`. Omit it where a case carries no suggestion. */
  advisory?: string | readonly string[];
  advisoryLabel?: string;
  /** Rewordable for a different surface, never removable. */
  divider?: string;
  /** The buttons. At least one: a panel with no action is a decision the machine already made. */
  actions: React.ReactNode;
  /** Names the action group. The reference leaves the group unnamed; a screen reader cannot. */
  actionsLabel?: string;
  /** Required. "Applied per … §x.y" is the difference between a decision and an opinion. */
  policy: PolicyCiteProps;
  /** The reference's grey note under the card (N2, line 3633). */
  footnote?: string;
  /**
   * Disambiguates the `aria-describedby` ids when two panels citing the same policy section share a
   * page. Defaults to a slug of the policy and section, which keeps the panel a server component —
   * `useId` would force a client boundary on every case screen in the console.
   */
  idPrefix?: string;
  className?: string;
}

/**
 * `.case-resolution` — the TrustOps decision surface, and the one pattern in this package that is a
 * trust-safety control rather than a layout.
 *
 * The structure is fixed and the order is the argument:
 *
 * 1. an `AdvisoryBox` — a separate named landmark, prose only, no control inside it;
 * 2. the "a human decides, always" divider;
 * 3. the actions, in their own `role="group"`, which the advisory is never part of;
 * 4. a `PolicyCite` footer naming the rule and the clause.
 *
 * The group is `aria-describedby` the divider and the citation, so arriving at the first action
 * announces "…, a human decides, always. Applied per New-Buyer Proposal Policy §2.1". In the
 * reference those two lines are 11px grey text that a screen-reader user moving by control skips
 * entirely; tying them to the group is what turns them from decoration into part of the control.
 */
export function DecisionPanel({
  heading = 'Decision',
  headingLevel = 2,
  advisory,
  advisoryLabel,
  divider = HUMAN_DECIDES,
  actions,
  actionsLabel = 'Decision actions',
  policy,
  footnote,
  idPrefix,
  className,
}: DecisionPanelProps): React.JSX.Element {
  if (Children.count(actions) === 0) {
    throw new TypeError(
      'DecisionPanel was given no actions. A decision surface with nothing to press is a decision ' +
        'that has already been made without a human, which is the one thing this panel exists to ' +
        'prevent. Pass the buttons, or do not render a DecisionPanel.',
    );
  }

  const prefix = idPrefix ?? slugId('decision', policy.policy, policy.section);
  const dividerId = `${prefix}-divider`;
  const policyId = `${prefix}-policy`;
  const describedBy = [advisory === undefined ? undefined : dividerId, policyId]
    .filter((id): id is string => id !== undefined)
    .join(' ');

  return (
    <div className={className}>
      <section
        aria-label={heading}
        className="mb-[16px] rounded-lg border border-solid border-border-hairline bg-surface-elevated p-[20px]"
      >
        <Heading level={headingLevel} className="mb-[10px] text-[14px] font-semibold">
          {heading}
        </Heading>

        {advisory !== undefined && (
          <AdvisoryBox {...(advisoryLabel === undefined ? {} : { label: advisoryLabel })}>
            {advisory}
          </AdvisoryBox>
        )}

        {advisory !== undefined && (
          <p
            id={dividerId}
            className="mx-[0px] my-[8px] flex items-center gap-[8px] text-center text-[11px] text-trust-gray"
          >
            {/* The reference draws these rules with `::before`/`::after`. A package that ships no
                stylesheet cannot reach a pseudo-element, so they are real, hidden elements. */}
            <span aria-hidden className="h-[1px] flex-1 bg-border-hairline" />
            {divider}
            <span aria-hidden className="h-[1px] flex-1 bg-border-hairline" />
          </p>
        )}

        <div
          role="group"
          aria-label={actionsLabel}
          aria-describedby={describedBy}
          className="flex flex-col gap-[8px]"
        >
          {actions}
        </div>

        <PolicyCite {...policy} id={policyId} />
      </section>

      {footnote !== undefined && <p className="text-[11px] leading-[1.6] text-trust-gray">{footnote}</p>}
    </div>
  );
}
