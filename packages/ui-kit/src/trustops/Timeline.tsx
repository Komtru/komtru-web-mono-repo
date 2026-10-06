import { type HeadingLevel } from './heading.js';
import { CasePanel } from './panel.js';

export interface TimelineEvent {
  id: string;
  title: string;
  /**
   * The reference writes the time into the prose rather than into a column — "10 Sep · 14:21 ·
   * Jibowu Hub recorded custody intake." A separate timestamp field would invite a second visual
   * column the reference does not draw.
   */
  detail?: string;
}

export interface TimelineProps {
  events: readonly TimelineEvent[];
  heading?: string;
  headingLevel?: HeadingLevel;
  className?: string;
  /** Rendered under the rail — `TrustTrail`'s immutability note lands here. */
  footer?: React.ReactNode;
  'aria-label'?: string;
}

/**
 * `.p0-timeline` from `<style id="komtru-unified-ds-v4">` — the case timeline, a vertical rail with
 * a node per event.
 *
 * An `<ol>`, because the order is the content: "release not completed" before "case opened" is the
 * whole story. The rail and the nodes are real `aria-hidden` elements rather than the reference's
 * `::before` pseudo-elements, because this package ships no stylesheet and cannot reach one.
 */
export function Timeline({
  events,
  heading = 'Case timeline',
  headingLevel = 2,
  className,
  footer,
  ...rest
}: TimelineProps): React.JSX.Element {
  if (events.length === 0) {
    throw new TypeError('Timeline was given no events. An empty trail is an empty state, not a timeline.');
  }
  return (
    <CasePanel
      heading={heading}
      headingLevel={headingLevel}
      {...(className === undefined ? {} : { className })}
      {...rest}
    >
      <ol className="relative list-none pl-[24px]">
        <span aria-hidden className="absolute bottom-[3px] left-[6px] top-[3px] w-[1px] bg-border-hairline" />
        {events.map((event) => (
          <li key={event.id} className="relative px-[0px] pt-[0px] pb-[18px]">
            <span
              aria-hidden
              className="absolute left-[-21px] top-[3px] h-[7px] w-[7px] rounded-[50%] border-[2px] border-solid border-surface-primary bg-trust-indigo shadow-[0_0_0_1px_var(--border-hairline)]"
            />
            <b className="font-body text-[12px] font-semibold">{event.title}</b>
            {event.detail !== undefined && (
              <p className="mx-[0px] mt-[4px] mb-[0px] font-body text-[12px] leading-[1.5] text-slate">
                {event.detail}
              </p>
            )}
          </li>
        ))}
      </ol>
      {footer}
    </CasePanel>
  );
}
