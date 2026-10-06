import { cx } from '../primitives/cx.js';
import { PolicyIcon } from './icons.js';

export interface PolicyCiteProps {
  /** The policy's name, without the section: `New-Buyer Proposal Policy`. */
  policy: string;
  /** The section, without the `§`: `2.1`. The component prints the sign. */
  section: string;
  /** The reference's trailing clause: "same threshold, every case". */
  note?: string;
  /**
   * What separates the clause from the citation. The reference writes `—` on N2 (line 3631) and `·`
   * on TO-PA2 (line 8884); both are in the document, so the component prints whichever it is told.
   */
  joiner?: string;
  id?: string;
  className?: string;
}

/**
 * `.policy-cite` — "Applied per New-Buyer Proposal Policy §2.1 — same threshold, every case".
 *
 * The reference sets this in `--font-mono`, and that is not a stylistic accident: a citation is a
 * thing a reader has to be able to quote back exactly, and the mono face is how the rest of the
 * product marks quotable strings (trade codes, hub ids, amounts). `section` is a separate required
 * field rather than part of `policy` so that a panel cannot cite a policy without citing the clause
 * inside it, which is the difference between "we have a rule" and "here is the rule we applied".
 */
export function PolicyCite({
  policy,
  section,
  note,
  joiner = '—',
  id,
  className,
}: PolicyCiteProps): React.JSX.Element {
  // A caller who writes `section="§2.1"` gets `§2.1`, not `§§2.1`.
  const clause = section.replace(/^§\s*/, '');
  return (
    <p
      id={id}
      className={cx('mt-[10px] flex items-center gap-[6px] font-mono text-[11px] text-trust-gray', className)}
    >
      <span aria-hidden className="h-[12px] w-[12px] shrink-0 stroke-trust-gray">
        <PolicyIcon />
      </span>
      {`Applied per ${policy} §${clause}${note === undefined ? '' : ` ${joiner} ${note}`}`}
    </p>
  );
}
