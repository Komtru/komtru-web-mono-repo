import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

/** The four button treatments the reference declares: `.btn-primary`, `-secondary`, `-ghost`, `-danger`. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BASE = `${FOCUS_RING} font-body font-semibold`;

const VARIANTS: Record<ButtonVariant, string> = {
  // .btn-primary — midnight fill, white label, full width. The one action a screen is really for.
  primary: `${BASE} bg-midnight-text text-pure-white border-none rounded-sm py-[12px] px-[18px] text-[13.5px] cursor-pointer w-full`,
  // .btn-secondary — 1.5px hairline outline; one less pixel of padding so both sit at the same height.
  secondary: `${BASE} bg-transparent text-midnight-text border-[1.5px] border-solid border-border-hairline rounded-sm py-[11px] px-[18px] text-[13.5px] cursor-pointer w-full`,
  // .btn-ghost — an underlined inline link, used for "Forgot password?" and "Send a new code".
  ghost: `${BASE} bg-transparent border-none text-slate text-[12.5px] underline cursor-pointer p-0`,
  // .btn-danger — the destructive confirmation inside a sheet, never a screen's default action.
  danger: `${BASE} bg-risk text-pure-white border-none rounded-sm py-[11px] px-[18px] text-[13.5px] cursor-pointer w-full`,
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={disabled === true ? true : undefined}
      className={cx(VARIANTS[variant], disabled === true && 'opacity-55', className)}
    />
  );
}
