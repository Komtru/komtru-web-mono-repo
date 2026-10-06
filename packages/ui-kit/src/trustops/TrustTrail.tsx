import { Timeline, type TimelineProps } from './Timeline.js';

/** The reference's own description of what the trail is (TO-PA5, line 8977). */
export const TRUST_TRAIL_CAPTION =
  'Incident, freeze, reviewer, decision and final release state are all immutable events.';

export interface TrustTrailProps extends Omit<TimelineProps, 'heading' | 'footer'> {
  heading?: string;
  /** The `.p13-audit` note. Say what the record guarantees; an empty string drops it. */
  caption?: string;
}

/**
 * The Trust Trail: the same rail as `Timeline`, under its product name, with the immutability claim
 * attached.
 *
 * A separate export rather than a `variant` prop, because the two are different promises. A
 * `Timeline` shows what is known so far and is rewritten as a case develops; a Trust Trail is the
 * audit record every policy cite in the product points at, and the reference's `.p13-audit` emerald
 * rule is its mark for "this cannot be edited". Shipping the caption with the component is what
 * stops a screen rendering the trail without the claim that makes it worth anything.
 */
export function TrustTrail({
  heading = 'Trust Trail',
  caption = TRUST_TRAIL_CAPTION,
  ...rest
}: TrustTrailProps): React.JSX.Element {
  return (
    <Timeline
      heading={heading}
      {...rest}
      footer={
        caption === '' ? null : (
          <p className="mt-[12px] border-l-[2px] border-solid border-l-trust-emerald pl-[12px]">
            <b className="block text-[11px]">{heading}</b>
            <span className="text-[10px] leading-[1.5] text-slate">{caption}</span>
          </p>
        )
      }
    />
  );
}
