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

/** `onClick`, `onKeyDown`, …: both run, the child's first. */
function composeHandlers(
  lent: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  const composed: Record<string, unknown> = {};
  for (const [name, lentValue] of Object.entries(lent)) {
    if (!/^on[A-Z]/.test(name) || typeof lentValue !== 'function') continue;
    const ownValue = own[name];
    if (typeof ownValue !== 'function') {
      composed[name] = lentValue;
      continue;
    }
    composed[name] = (...args: unknown[]) => {
      (ownValue as (...a: unknown[]) => void)(...args);
      (lentValue as (...a: unknown[]) => void)(...args);
    };
  }
  return composed;
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
    const { children, ...lent } = rest;
    if (!isValidElement<Record<string, unknown>>(children)) {
      // A string, a fragment, two children: there is no single element to lend the treatment to,
      // and silently rendering a bare `<button>` instead would hide the mistake behind a control
      // that looks right and is the wrong element.
      throw new TypeError('Button asChild needs exactly one element child');
    }
    if (disabled === true) {
      // `disabled` is not an attribute an `<a>` has, so the treatment would dim a control that is
      // still perfectly clickable and announces nothing. Which element to render is the caller's.
      throw new TypeError('Button asChild cannot be disabled; render a disabled <button> instead');
    }
    // Every prop reaches the child, the way the name promises. Where both declare the same thing
    // the child wins — it is the more specific statement — except for handlers, which both run,
    // child first, so the element's own behaviour is never silently replaced.
    return cloneElement(children, {
      ...lent,
      ...children.props,
      ...composeHandlers(lent, children.props),
      className: cx(classes, children.props.className as string | undefined),
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
