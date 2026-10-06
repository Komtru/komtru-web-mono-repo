import { cx } from './cx.js';

/** The three sizes the reference draws: 20px inside a trade row, 34px standing alone, 44px on the passport. */
export type AvatarSize = 'sm' | 'md' | 'lg';
/** The soft/on-soft pairs the reference fills an avatar with. */
export type AvatarTone = 'info' | 'warning' | 'success';

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-[20px] w-[20px] text-[9px]',
  md: 'h-[34px] w-[34px] text-[12px]',
  lg: 'h-[44px] w-[44px] text-[15px]',
};

const TONES: Record<AvatarTone, string> = {
  info: 'bg-trust-indigo-soft text-info-on-soft',
  warning: 'bg-warning-soft text-warning-on-soft',
  success: 'bg-trust-emerald-soft text-trust-emerald',
};

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Trimmed to two characters and upper-cased, the way every instance in the reference is written. */
  initials: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  /** Without a label the avatar is decoration beside a name that is already on screen. */
  label?: string;
}

export function Avatar({
  initials,
  size = 'md',
  tone = 'info',
  label,
  className,
  ...rest
}: AvatarProps): React.JSX.Element {
  return (
    <div
      {...rest}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cx(
        'flex shrink-0 items-center justify-center rounded-[50%] font-display font-bold',
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {initials.slice(0, 2).toUpperCase()}
    </div>
  );
}
