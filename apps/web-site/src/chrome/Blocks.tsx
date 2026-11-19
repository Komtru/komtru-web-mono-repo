/**
 * The four blocks that recur across the pages below the home page.
 *
 * Each of these appears on three or four of the thirteen pages. They live here rather than in
 * each page because the alternative — thirteen pages each writing its own checklist markup — is
 * thirteen chances for the mark to end up a different size, or for a list to lose the `<li>` that
 * makes it a list to a screen reader. The CSS they rely on is in `app/site.css`.
 *
 * None of them is a client component. They render markup and nothing else.
 */

/** Indigo informs, emerald protects, amber cautions, red is a thing that went wrong. */
export type Tone = 'indigo' | 'emerald' | 'amber' | 'risk';

const TONE_FILL: Record<Tone, { background: string; color: string }> = {
  indigo: { background: 'var(--trust-indigo-soft)', color: 'var(--trust-indigo)' },
  emerald: { background: 'var(--trust-emerald-soft)', color: 'var(--trust-emerald)' },
  amber: { background: 'var(--warning-soft)', color: 'var(--warning-on-soft)' },
  risk: { background: 'var(--risk-soft)', color: 'var(--risk)' },
};

/**
 * The rounded square above a card's heading.
 *
 * The icon is a child rather than a name, so a page can pass any mark from `src/art/Icons.tsx`
 * without this file having to know the set. It inherits `color` from the tile, so an icon drawn
 * with `stroke="currentColor"` takes the tone automatically.
 */
export function IconTile({ tone, children }: { tone: Tone; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="icn" style={TONE_FILL[tone]} aria-hidden>
      {children}
    </div>
  );
}

/** A tick, for a line that counts in someone's favour. */
function Tick(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="var(--success-on-soft)"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/** A cross, for a line that counts against it. */
function Cross(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="var(--risk)"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

export interface CheckItem {
  /** Rich rather than a string: several of these lead with a bolded phrase. */
  readonly text: React.ReactNode;
  /** A cross instead of a tick. Defaults to a tick, which is the common case. */
  readonly bad?: boolean;
}

/**
 * A list where every line is a claim and the mark says which way it counts.
 *
 * The mark is decorative and the colour alone would carry the meaning, so each line names its own
 * sense for anyone not seeing it — otherwise "photos you took yourself" and "photos from a
 * catalogue" read identically aloud.
 */
export function Checks({ items }: { items: readonly CheckItem[] }): React.JSX.Element {
  return (
    <ul className="cks">
      {items.map((item, index) => (
        <li key={index}>
          <i className={item.bad === true ? 'x' : ''}>{item.bad === true ? <Cross /> : <Tick />}</i>
          <span>
            <span className="sr-only">{item.bad === true ? 'No: ' : 'Yes: '}</span>
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A clock face, for a note that is information. */
function InfoMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="var(--trust-indigo)"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** A warning triangle, for a note that is a caution. */
function WarnMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="var(--warning-on-soft)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

/**
 * An aside the page wants read rather than skimmed.
 *
 * `tone="warn"` is the amber one. Across the whole site it means a single thing — that something
 * here can take someone's payment protection away — so don't reach for it to emphasise copy.
 */
export function InfoBox({
  tone = 'info',
  style,
  children,
}: {
  tone?: 'info' | 'warn';
  style?: React.CSSProperties;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={tone === 'warn' ? 'info warnb' : 'info'} style={style}>
      {tone === 'warn' ? <WarnMark /> : <InfoMark />}
      <span>{children}</span>
    </div>
  );
}

export interface Step {
  readonly title: string;
  readonly body: React.ReactNode;
}

/**
 * The numbered row describing how something proceeds, left to right.
 *
 * The count goes into `--c` because the connector hairline between steps is drawn by the CSS and
 * has to know where the row ends. Steps are numbered from their position: a list whose visible
 * numbers could disagree with their order is a list that will eventually disagree with it.
 */
export function Steps({ steps }: { steps: readonly Step[] }): React.JSX.Element {
  return (
    <div className="sp" style={{ '--c': steps.length } as React.CSSProperties}>
      {steps.map((step, index) => (
        <div className="spi rv" key={step.title}>
          <div className="spn">{index + 1}</div>
          <b>{step.title}</b>
          <p>{step.body}</p>
        </div>
      ))}
    </div>
  );
}
