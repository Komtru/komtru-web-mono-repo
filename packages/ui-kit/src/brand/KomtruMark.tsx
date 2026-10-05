import { cssVar } from '../tokens.js';

/** The two node radii the reference actually draws: 2.2 beside "Komtru", 2.3 beside "Komtru Ops". */
export type KomtruMarkNodeRadius = 2.2 | 2.3;

export interface KomtruMarkProps {
  /** Width and height in pixels. The reference draws the mark at 15, 16, 20 and 40. */
  size?: number;
  nodeRadius?: KomtruMarkNodeRadius;
  /** Giving the mark a name turns it into an image; without one it is decorative. */
  title?: string;
  className?: string;
}

/**
 * Three nodes and the two links between them, exactly as the reference HTML draws them: one party,
 * the other party, and Komtru holding the middle.
 */
export function KomtruMark({
  size = 16,
  nodeRadius = 2.2,
  title,
  className,
}: KomtruMarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cssVar('--trust-emerald')}
      strokeWidth={2}
      strokeLinecap="round"
      {...(title === undefined
        ? { 'aria-hidden': true, focusable: false }
        : { role: 'img', focusable: false })}
    >
      {title !== undefined && <title>{title}</title>}
      <circle cx="6" cy="12" r={nodeRadius} />
      <circle cx="18" cy="6" r={nodeRadius} />
      <circle cx="18" cy="18" r={nodeRadius} />
      <path d="M8 11l8-4M8 13l8 4" />
    </svg>
  );
}
