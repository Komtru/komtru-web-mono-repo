import { cx } from '../primitives/cx.js';
import { AdvisoryIcon } from './icons.js';

/** The reference's own words, in all four screens that draw this box. Never shortened. */
export const ADVISORY_LABEL = 'AI-suggested — not a decision';

export interface AdvisoryBoxProps {
  /**
   * Prose, and only prose. An array renders one paragraph per entry.
   *
   * This is `string`, not `React.ReactNode`, on purpose and it is the most important line in the
   * package: T-014 requires that the advisory can never contain an action, and a type that admits
   * no elements makes that a compile error rather than a code-review habit. The runtime guard below
   * covers the JavaScript caller that `tsc` never sees.
   */
  children: string | readonly string[];
  /** Overridable for a non-AI advisory (a policy engine, a partner's risk score). */
  label?: string;
  id?: string;
  className?: string;
}

function paragraphs(children: string | readonly string[]): readonly string[] {
  const list = typeof children === 'string' ? [children] : children;
  for (const entry of list) {
    if (typeof entry !== 'string') {
      throw new TypeError(
        'AdvisoryBox renders prose only. Something other than a string was passed as its content, ' +
          'which would let an action render inside the advisory — the one thing a decision surface ' +
          'must never allow. Put the control in DecisionPanel’s `actions` instead.',
      );
    }
  }
  if (list.length === 0) throw new TypeError('AdvisoryBox was given no advice to show.');
  return list;
}

/**
 * `.ai-recommend` — the dashed-indigo advisory box.
 *
 * It is a **named `region` landmark**, which is the semantic half of the separation the ticket asks
 * for. The reference draws a dashed border and a 10px uppercase label; to a screen reader that is an
 * unlabelled run of text that a user moving by control or by landmark never hears at all. As a region
 * named "AI-suggested — not a decision", it can be jumped to and — the part that matters — jumped out
 * of, and its name is announced before a word of the advice is read.
 *
 * `region` rather than `complementary`: an advisory is never top-level — it lives inside a case — and
 * a nested complementary landmark is exactly what axe's `landmark-complementary-is-top-level` exists
 * to flag.
 */
export function AdvisoryBox({
  children,
  label = ADVISORY_LABEL,
  id,
  className,
}: AdvisoryBoxProps): React.JSX.Element {
  return (
    <section
      id={id}
      aria-label={label}
      className={cx(
        // The only dashed border in the reference document. The border style is the argument: this
        // box is provisional, and everything else on the screen is not.
        'mb-[16px] rounded-md border border-dashed border-trust-indigo bg-trust-indigo-soft py-[14px] px-[16px]',
        className,
      )}
    >
      <p className="mb-[6px] flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-[.05em] text-info-on-soft">
        <span aria-hidden className="h-[12px] w-[12px] shrink-0">
          <AdvisoryIcon />
        </span>
        {label}
      </p>
      {paragraphs(children).map((paragraph) => (
        <p key={paragraph} className="text-[12px] leading-[1.5] text-midnight-text">
          {paragraph}
        </p>
      ))}
    </section>
  );
}
