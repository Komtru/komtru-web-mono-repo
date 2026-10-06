import { cloneElement, isValidElement } from 'react';
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
  /**
   * Lend the treatment to the single child element instead of rendering a `<button>`. The reference
   * draws every action as a `<button>` because it is a drawing; in a product, an action that
   * navigates is an `<a>` — it opens in a new tab, its address can be copied, and a screen reader
   * announces it as a link. Added in T-017 for the error and not-found screens' way out, and for
   * every screen ticket whose "Continue" is a navigation rather than a submit.
   */
  asChild?: boolean;
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  disabled,
  asChild = false,
  ...rest
}: ButtonProps): React.JSX.Element {
  const classes = cx(VARIANTS[variant], disabled === true && 'opacity-55', className);

  if (asChild) {
    const child: unknown = rest.children;
    if (!isValidElement<{ className?: string }>(child)) {
      // A string, a fragment, two children: there is no single element to lend the treatment to,
      // and silently rendering a bare `<button>` instead would hide the mistake behind a control
      // that looks right and is the wrong element.
      throw new TypeError('Button asChild needs exactly one element child');
    }
    return cloneElement(child, {
      className: cx(classes, child.props.className),
    });
  }

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={disabled === true ? true : undefined}
      className={classes}
    />
  );
}
