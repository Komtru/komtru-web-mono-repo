import { StickyFooter } from '@komtru/ui-kit';

/**
 * The walkthrough's frame: the screen's content, and the actions pinned under it as the reference draws them
 * (`.btn-sticky`). No tab bar and no header: these screens sit before the app does, and the reference draws none.
 */
export function WelcomeFrame({
  children,
  footer,
  footerRow = false,
  flush = false,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  /** OB1–OB3 put Skip and Next side by side; OB4 and OB5 stack their two actions. */
  footerRow?: boolean;
  /** OB4 and OB5 start at the top of the screen; the walkthrough's drawings are pushed down 36px. */
  flush?: boolean;
}): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <div className={`flex flex-1 flex-col px-[16px] ${flush ? '' : 'pt-[36px]'}`}>{children}</div>
      <StickyFooter className={footerRow ? 'flex-row gap-[10px]' : undefined}>{footer}</StickyFooter>
    </main>
  );
}

const DOTS = [1, 2, 3] as const;

/** `.walkthrough-dots`: three dots, the current one stretched. A picture of position, so it is named as one. */
export function Dots({ at }: { at: 1 | 2 | 3 }): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label={`Step ${String(at)} of 3`}
      className="mb-[22px] flex justify-center gap-[6px]"
    >
      {DOTS.map((n) => (
        <span
          key={n}
          className={
            n === at
              ? 'h-[6px] w-[18px] rounded-[3px] bg-trust-indigo'
              : 'h-[6px] w-[6px] rounded-[50%] bg-stone-gray'
          }
        />
      ))}
    </div>
  );
}

const ART = {
  common: {
    width: 72,
    height: 72,
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: 1.4,
    'aria-hidden': true,
  },
} as const;

/** The three drawings from OB1–OB3, 72px, in the stroke colours the reference gives each. */
export function WalkthroughArt({ step }: { step: '1' | '2' | '3' }): React.JSX.Element {
  return (
    <div className="my-[8px] mb-[20px] flex h-[180px] items-center justify-center">
      {step === '1' && (
        <svg {...ART.common} strokeLinecap="round" strokeLinejoin="round" className="stroke-trust-emerald">
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="18" cy="18" r="2.4" />
          <path d="M8.2 11l7.6-4M8.2 13l7.6 4" />
          <circle cx="18" cy="12" r="8" className="stroke-trust-indigo-soft" strokeDasharray="2 3" />
        </svg>
      )}
      {step === '2' && (
        <svg {...ART.common} strokeLinecap="round" className="stroke-trust-indigo">
          <path d="M4 16l5-5 4 4 7-8" />
          <path d="M15 7h5v5" />
        </svg>
      )}
      {step === '3' && (
        <svg {...ART.common} strokeLinecap="round" className="stroke-trust-emerald">
          <path d="M6 10a6 6 0 1 1 3.3 5.4" />
          <path d="M6 16v-4h4" />
        </svg>
      )}
    </div>
  );
}
