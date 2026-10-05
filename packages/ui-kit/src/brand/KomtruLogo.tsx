import { KomtruMark, type KomtruMarkNodeRadius } from './KomtruMark.js';
import { cssVar } from '../tokens.js';

export interface KomtruLogoProps {
  /** `'ops'` gives the staff console's lockup; omitted gives the consumer one. */
  product?: 'ops';
  /** Overrides the mark's size only; the wordmark keeps the reference's type scale. */
  size?: number;
  className?: string;
  /** Merged last, so a caller can reach the lockup's own layout values. */
  style?: React.CSSProperties;
}

/**
 * The two lockups the reference uses: `.scr-logo` in the consumer apps and `.ds-logo` in the ops
 * console. They differ in wordmark, type size, gap and — in the reference's own drawing — node radius.
 */
const LOCKUPS = {
  consumer: { wordmark: 'Komtru', fontSize: 14, gap: 6, nodeRadius: 2.2 },
  ops: { wordmark: 'Komtru Ops', fontSize: 13, gap: 7, nodeRadius: 2.3 },
} as const satisfies Record<
  string,
  { wordmark: string; fontSize: number; gap: number; nodeRadius: KomtruMarkNodeRadius }
>;

export function KomtruLogo({ product, size = 16, className, style }: KomtruLogoProps): React.JSX.Element {
  const lockup = LOCKUPS[product ?? 'consumer'];

  return (
    <span
      className={className}
      role="img"
      aria-label={lockup.wordmark}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${lockup.gap}px`,
        fontFamily: cssVar('--font-display'),
        fontWeight: 600,
        fontSize: `${lockup.fontSize}px`,
        ...style,
      }}
    >
      <KomtruMark size={size} nodeRadius={lockup.nodeRadius} />
      {lockup.wordmark}
    </span>
  );
}
