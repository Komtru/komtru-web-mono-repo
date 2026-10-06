import { cx } from '../primitives/cx.js';
import { type HeadingLevel } from './heading.js';
import { EvidenceIcon } from './icons.js';
import { CasePanel } from './panel.js';

/**
 * The three states the reference's evidence matrix draws (TO-PA2, line 8862), named for what a
 * reviewer concludes rather than for the colour: `pass` is settled, `gap` is missing and blocks,
 * `check` is present but unconfirmed. They map onto `.p13-state`'s `ready`, `hold` and `review`.
 */
export type EvidenceState = 'pass' | 'gap' | 'check';

const STATE_LABELS: Record<EvidenceState, string> = { pass: 'Pass', gap: 'Gap', check: 'Check' };

const STATE_TONES: Record<EvidenceState, string> = {
  pass: 'bg-success-soft text-success-on-soft',
  gap: 'bg-warning-soft text-warning-on-soft',
  check: 'bg-info-soft text-info-on-soft',
};

export interface EvidenceRow {
  id: string;
  /** What is being evidenced: "Identity", "Park authority", "Payout". */
  label: string;
  /** What has been seen, and what has not: "Counter photo · staff authority not yet proven". */
  detail: string;
  state: EvidenceState;
  icon?: React.ReactNode;
}

export interface EvidenceMatrixProps {
  rows: readonly EvidenceRow[];
  heading?: string;
  headingLevel?: HeadingLevel;
  /**
   * Shown in place of the rows when there are none. `rows` is server data — a case opened seconds
   * ago, a filtered view, a partial response — so an empty list degrades rather than throwing and
   * taking the case route down with it.
   */
  empty?: React.ReactNode;
  className?: string;
}

/**
 * `.p13-req` rows inside a `.timeline` panel — the "explicit evidence matrix" TO-PA2 adds over PH7.
 *
 * A list, not a table: each row is one requirement with one state, and a `listitem` lets a screen
 * reader count them ("4 items") before reading any, which is the first thing a reviewer wants to
 * know. The state word travels in the text rather than in the colour, so "Gap" is still a gap in a
 * high-contrast theme, in a screenshot, and to someone who cannot tell amber from green.
 */
export function EvidenceMatrix({
  rows,
  heading = 'Evidence matrix',
  headingLevel = 2,
  empty,
  className,
}: EvidenceMatrixProps): React.JSX.Element {
  return (
    <CasePanel
      heading={heading}
      headingLevel={headingLevel}
      {...(className === undefined ? {} : { className })}
    >
      {rows.length === 0 ? (
        <p className="text-[11.5px] leading-[1.5] text-slate">
          {empty === undefined ? 'No evidence has been recorded on this case yet.' : empty}
        </p>
      ) : (
        <ul className="list-none">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex gap-[10px] border-t border-solid border-t-border-hairline py-[10px] px-[0px] first:border-t-0"
            >
              <span
                aria-hidden
                className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm bg-info-soft"
              >
                <span className="block h-[14px] w-[14px] stroke-info-on-soft">
                  {row.icon ?? <EvidenceIcon />}
                </span>
              </span>
              {/* No `flex-1`: the reference lets the state badge sit immediately after the text, so
                the badge column is ragged. Right-aligning it would scan better and would also stop
                reproducing the screen this component exists to reproduce. */}
              <div className="min-w-0">
                <b className="block text-[11.5px]">{row.label}</b>
                <span className="text-[10.5px] leading-[1.4] text-slate">{row.detail}</span>
              </div>
              <span
                className={cx(
                  'inline-flex items-center gap-[6px] rounded-full py-[5px] px-[9px] text-[10px] font-bold',
                  STATE_TONES[row.state],
                )}
              >
                {STATE_LABELS[row.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CasePanel>
  );
}
