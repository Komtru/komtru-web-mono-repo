'use client';

import { Children, isValidElement, useId } from 'react';
import { AdvisoryBox } from './AdvisoryBox.js';
import { Heading, type HeadingLevel } from './heading.js';
import { PolicyCite, type PolicyCiteProps } from './PolicyCite.js';

/** The reference's `.human-decides` copy, drawn under every advisory in the document. */
export const HUMAN_DECIDES = 'a human decides, always';

export interface DecisionPanelProps {
  heading?: string;
  headingLevel?: HeadingLevel;
  /** Prose only — see `AdvisoryBox`. Omit it where a case carries no suggestion. */
  advisory?: string | readonly string[];
  advisoryLabel?: string;
  /** Rewordable for a different surface, never removable, never blank. */
  divider?: string;
  /** The buttons. At least one: a panel with no action is a decision the machine already made. */
  actions: React.ReactNode;
  /** Names the action group. The reference leaves the group unnamed; a screen reader cannot. */
  actionsLabel?: string;
  /** Required. "Applied per … §x.y" is the difference between a decision and an opinion. */
  policy: PolicyCiteProps;
  /** The reference's grey note under the card (N2, line 3633). */
  footnote?: string;
  /** Fixes the generated ids, for a test that wants to assert on them. */
  idPrefix?: string;
  className?: string;
}

/** A name that is only whitespace is no name, and an unnamed `<section>` is not a landmark at all. */
function requireText(value: string, prop: string, why: string): string {
  if (value.trim() === '') {
    throw new TypeError(`DecisionPanel's \`${prop}\` cannot be blank: ${why}`);
  }
  return value;
}

/**
 * True if an `AdvisoryBox` is anywhere in this element tree.
 *
 * `actions` is a `ReactNode`, so the type system cannot keep an advisory out of the button group the
 * way `AdvisoryBox`'s `string` children keep a button out of the advisory. This closes the other
 * half: a screen that passes `actions={<><AdvisoryBox …/><Button/></>}` would otherwise put a second,
 * correctly-named advisory landmark *inside* the group, which is the exact arrangement the panel
 * exists to prevent. The walk is depth-limited and only sees elements, not what a wrapper component
 * returns — it catches the mistake someone actually makes, not every mistake possible.
 */
function containsAdvisory(node: React.ReactNode, depth = 0): boolean {
  if (depth > 8) return false;
  return Children.toArray(node).some((child) => {
    if (!isValidElement(child)) return false;
    if (child.type === AdvisoryBox) return true;
    const { children } = child.props as { children?: React.ReactNode };
    return children === undefined ? false : containsAdvisory(children, depth + 1);
  });
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
 *
 * `'use client'` for one reason: `useId`. The ids behind `aria-describedby` have to be unique on a
 * page, and an earlier version derived them from the policy citation to stay a server component —
 * which meant two panels citing the same clause, the ordinary case on a queue screen, emitted
 * duplicate ids and the second panel described itself with the first one's text. A silent
 * mis-description on the control this component exists to make honest is not worth a server
 * boundary; this is the same trade T-012 took for `TextField`.
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
  const generated = useId();

  // `Children.toArray`, not `Children.count`: `count` counts `false` and `null` as children, so the
  // idiomatic `actions={canApprove && <Button/>}` sailed past this guard and rendered an empty group
  // under an AI suggestion — a decision surface with nothing to press, which is what it forbids.
  if (Children.toArray(actions).length === 0) {
    throw new TypeError(
      'DecisionPanel was given no actions. A decision surface with nothing to press is a decision ' +
        'that has already been made without a human, which is the one thing this panel exists to ' +
        'prevent. Pass the buttons, or do not render a DecisionPanel.',
    );
  }
  if (containsAdvisory(actions)) {
    throw new TypeError(
      'DecisionPanel was given an AdvisoryBox among its actions. Advice and action are separate ' +
        'landmarks here on purpose: an advisory inside the button group is read as part of the ' +
        'controls. Pass the prose as `advisory` instead.',
    );
  }

  requireText(heading, 'heading', 'it names the panel’s landmark.');
  requireText(actionsLabel, 'actionsLabel', 'it names the action group.');
  requireText(
    divider,
    'divider',
    'it is the sentence the action group is described by — blanking it removes "a human decides, ' +
      'always" from what a screen reader announces on the buttons.',
  );

  const prefix = idPrefix ?? generated;
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

        {/*
          No `aria-owns` here, ever. It reparents a node in the accessibility tree without moving it
          in the DOM, so adding one pointing at the advisory would put the advisory inside this group
          for every screen reader while every DOM-containment assertion kept passing. The test suite
          checks for it explicitly.
        */}
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
