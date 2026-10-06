// The width at which a Komtru app stops drawing `MobileShell` and starts drawing `DesktopShell`.
//
// T-013 named this rule and could not enforce it: no shell carries an `md:` variant, because every
// shape change *inside* a shell is at `lg` (the nav swap, the padding step, the console rail) or at
// `sm` (the console page head). `md` is the boundary between two different shells, which is an
// app-level decision — the reference's own rule is "tablet gets no bespoke screens, it inherits the
// desktop shell", and 768 is where that inheritance starts.
//
// **Why this is a rule and not a component.** A Next app does not know the viewport width on the
// server, so a runtime swap has exactly two shapes and both are worse than the rule:
//
//   * render both shells and hide one with CSS — which puts the page's content in the DOM twice,
//     under two `<main>` landmarks, with two copies of every id, label and form control;
//   * decide in the client with `matchMedia` — which pushes a client boundary around every screen
//     (T-013 kept all four shells server components on purpose) and hands every desktop visitor a
//     mobile first paint that snaps to the desktop layout after hydration.
//
// So the app's layout applies this rule once, where it knows which route it is drawing, and these
// three values are the only place the number lives.
import { BREAKPOINTS } from '@komtru/ui-kit';

export const SHELL_BREAKPOINT = BREAKPOINTS.md;

/** The Tailwind variant that is this width, for a screen that needs to say it in CSS. */
export const SHELL_VARIANT = 'md' as const;

/** What that variant compiles to. `test/layout.test.ts` holds the two together. */
export const SHELL_MEDIA_QUERY = '(width >= 48rem)';

export type ShellKind = 'mobile' | 'desktop';

/** Below the breakpoint, not at it: `md:` fires *at* 768, so 768 is already the desktop shell. */
export const shellForWidth = (width: number): ShellKind => (width < SHELL_BREAKPOINT ? 'mobile' : 'desktop');
