import { KomtruLogo, StickyFooter } from '@komtru/ui-kit';
import { useViewport } from '../trade/workspace/viewport';
import { WELCOME_STEPS, type StepKey } from './steps';

/**
 * The walkthrough's frame. On a phone: the screen's content, and the actions pinned under it as the reference draws
 * them (`.btn-sticky`), no tab bar and no header. From 768px the same nodes become TX-01's card, a centred card on a
 * calm background under the Komtru mark, with the actions at the card's foot rather than pinned to the window.
 * `wide` is the roomier desktop card the three-point overview needs (OB1–OB3).
 *
 * It is all classes, so a window that crosses a breakpoint redraws without remounting anything.
 */
export function WelcomeFrame({
  children,
  footer,
  footerRow = false,
  flush = false,
  wide = false,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  /** OB1–OB3 put Skip and Next side by side; OB4 and OB5 stack their two actions. */
  footerRow?: boolean;
  /** OB4 and OB5 start at the top of the screen; the walkthrough's drawings are pushed down 36px. */
  flush?: boolean;
  /** OB1–OB3: the card is wide enough on a desktop to hold the three points beside the step. */
  wide?: boolean;
}): React.JSX.Element {
  const card = wide ? 'lg:max-w-[880px]' : 'lg:max-w-[600px]';
  const actions = footerRow
    ? 'flex-row gap-[10px] md:justify-between md:gap-[16px]'
    : 'md:mx-auto md:w-full md:max-w-[360px]';
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col md:max-w-none md:items-center md:justify-center md:gap-[24px] md:bg-surface-secondary md:px-[40px] md:py-[56px]">
      <div aria-hidden className="hidden md:block">
        <KomtruLogo size={20} />
      </div>
      <div
        className={`flex w-full flex-1 flex-col md:max-w-[560px] md:flex-none md:rounded-lg md:border md:border-solid md:border-border-hairline md:bg-surface-primary md:p-[40px] md:shadow-card lg:p-[56px] ${card}`}
      >
        <div
          className={`flex flex-1 flex-col px-[16px] md:flex-none md:px-0 ${flush ? '' : 'pt-[36px] md:pt-0'}`}
        >
          {children}
        </div>
        <StickyFooter className={`${actions} md:static md:mt-[32px] md:bg-none md:p-0`}>
          {footer}
        </StickyFooter>
      </div>
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
      className="mb-[22px] flex justify-center gap-[6px] md:mb-0"
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
const ART_SIZE = 'md:h-[88px] md:w-[88px] lg:h-[96px] lg:w-[96px]';

/** The three drawings from OB1–OB3, 72px, in the stroke colours the reference gives each. */
export function WalkthroughArt({ step }: { step: '1' | '2' | '3' }): React.JSX.Element {
  return (
    <div className="my-[8px] mb-[20px] flex h-[180px] items-center justify-center md:mt-0 md:h-[160px]">
      {step === '1' && (
        <svg
          {...ART.common}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`stroke-trust-emerald ${ART_SIZE}`}
        >
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="18" cy="18" r="2.4" />
          <path d="M8.2 11l7.6-4M8.2 13l7.6 4" />
          <circle cx="18" cy="12" r="8" className="stroke-trust-indigo-soft" strokeDasharray="2 3" />
        </svg>
      )}
      {step === '2' && (
        <svg {...ART.common} strokeLinecap="round" className={`stroke-trust-indigo ${ART_SIZE}`}>
          <path d="M4 16l5-5 4 4 7-8" />
          <path d="M15 7h5v5" />
        </svg>
      )}
      {step === '3' && (
        <svg {...ART.common} strokeLinecap="round" className={`stroke-trust-emerald ${ART_SIZE}`}>
          <path d="M6 10a6 6 0 1 1 3.3 5.4" />
          <path d="M6 16v-4h4" />
        </svg>
      )}
    </div>
  );
}

const POINTS = WELCOME_STEPS.filter((step) => step.key === '1' || step.key === '2' || step.key === '3');

/**
 * Desktop only: the walkthrough's three points in one place beside the step, the current one marked, so the page's
 * width shows where the person is in the whole. It repeats the headings, so it is drawn from `useViewport` and not
 * hidden with CSS: a phone, a tablet and a reader of the page on either never meet the copy twice.
 */
export function Overview({ at }: { at: StepKey }): React.JSX.Element | null {
  const viewport = useViewport();
  if (viewport !== 'desktop') return null;
  return (
    <aside className="mr-[40px] w-[250px] shrink-0 self-stretch border-0 border-r border-solid border-border-hairline pr-[32px]">
      <p className="mb-[16px] text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
        What makes Komtru different
      </p>
      <ol aria-label="The three things Komtru does" className="m-0 flex list-none flex-col gap-[6px] p-0">
        {POINTS.map((point, index) => {
          const current = point.key === at;
          return (
            <li
              key={point.key}
              aria-current={current ? 'step' : undefined}
              className={`flex items-start gap-[12px] rounded-md px-[12px] py-[12px] text-[13.5px] leading-[1.4] ${
                current ? 'bg-surface-secondary font-semibold text-midnight-text' : 'text-slate'
              }`}
            >
              <span
                aria-hidden
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[50%] text-[11px] font-semibold ${
                  current ? 'bg-trust-indigo text-pure-white' : 'bg-surface-secondary text-slate'
                }`}
              >
                {index + 1}
              </span>
              {point.title}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
