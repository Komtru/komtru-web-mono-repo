'use client';

import { KomtruLogo, StickyFooter, TopBar } from '@komtru/ui-kit';
import { TRADE_CODE_EXAMPLE } from '@komtru/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { tradeCodeOf } from '../../home/classify';
import { useViewport } from '../../trade/workspace/viewport';
import { countdown, RESEND_AFTER_SECONDS } from '../flow';

/** The line the reference sets over every wide entry screen's brand story. */
export const HEADLINE = 'Trade with strangers, protected.';

const POINTS = [
  ['Agree before you pay', 'Item, price, delivery and inspection are written down first.'],
  ['Payment stays protected', 'Funds are released only when the agreed terms are met.'],
  ['Every trade builds your record', 'Completed trades become evidence others can see.'],
] as const;

const DISPLAY = 'font-[family-name:var(--font-display)]';

/**
 * Every entry screen's page, at three widths in one tree.
 *
 * A phone (under 768px) is the reference's mobile web page: `.scr-topbar` with a way back, the body, and the sticky
 * footer that holds the screen's real actions, in a 480px column.
 *
 * The reference draws two wide entry screens, DX-01 (desktop, log in) and TX-01 (tablet, log in), and every other
 * entry screen on a phone only. An earlier version of this frame centred the phone column on a wide window "rather
 * than a desktop layout nobody drew". The owner has reversed that: every entry screen now takes the two drawings'
 * frames, with the undrawn screens' own content and actions where the form is.
 *
 * - **Tablet (md, 768px+), TX-01:** a calm page with the wordmark above one centred card holding the body and, under
 *   it, the actions side by side. Log in, welcome and sign up also carry "Have a Trade Code? Enter it here".
 * - **Desktop (lg, 1024px+), DX-01:** the brand story and Trade Code entry on the left, the screen on the right, its
 *   actions stacked under the form instead of stuck to the bottom of a window.
 *
 * It is one tree. The width changes classes, never what the body is mounted under, so a form someone is typing into
 * survives a window resize or a rotated tablet. The hook is read only for what a width adds beside the body (the brand
 * panel, the tablet intro, the Trade Code line, a Back link in place of the top bar), and it answers "phone" on the
 * server and in tests that do not draw a window, so a phone's markup carries none of them.
 */
export function EntryFrame({
  title,
  back,
  footer,
  children,
  tradeCode = false,
  intro = 'wordmark',
  brandHeading = false,
  wideBack = true,
}: {
  /** The top bar's name. Omitted for the screens the reference draws without one (E1, TOS2). */
  title?: string;
  back?: string;
  /** The screen's actions. A screen that only reads, such as the full Terms, has none. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** TX-01's "Have a Trade Code? Enter it here" under the tablet card: log in, welcome and sign up. */
  tradeCode?: boolean;
  /** What sits above the tablet card: the wordmark, the wordmark and the headline, or nothing (the body has them). */
  intro?: 'wordmark' | 'headline' | 'none';
  /** The screen has no heading of its own at desktop width, so the brand story's headline is the page's `h1`. */
  brandHeading?: boolean;
  /** Whether a wide window draws the Back link. DX-01 and TX-01 draw none on log in, the way in. */
  wideBack?: boolean;
}): React.JSX.Element {
  const viewport = useViewport();
  const wide = viewport !== 'mobile';

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-none">
      <div className="relative flex min-h-dvh flex-col bg-surface-secondary lg:flex-row lg:bg-surface-primary">
        {/* DX-01's left column. The gradient is always here, so a desktop window is the right shape before the story arrives. */}
        <div className="hidden bg-[linear-gradient(150deg,var(--komtru-midnight),color-mix(in_srgb,var(--komtru-midnight),var(--trust-indigo)_10%))] text-pure-white lg:flex lg:flex-[1.1] lg:flex-col lg:p-[44px]">
          {viewport === 'desktop' && <BrandStory heading={brandHeading} />}
        </div>
        <div className="flex flex-1 flex-col md:items-center md:justify-center md:px-[48px] md:py-[48px] lg:flex-[0.9] lg:bg-surface-primary lg:px-[56px]">
          {/* `contents`, so the sticky bar still sticks to the page; a wide window draws a Back link in the card instead. */}
          {title !== undefined && viewport === 'mobile' && (
            <div className="contents md:hidden">
              <TopBar
                title={title}
                {...(back === undefined ? {} : { back: { label: 'Back', href: back } })}
              />
            </div>
          )}
          {viewport === 'tablet' && intro !== 'none' && <TabletIntro headline={intro === 'headline'} />}
          <div className="flex flex-1 flex-col md:w-full md:max-w-[600px] md:flex-none md:rounded-[var(--r-lg)] md:border md:border-solid md:border-border-hairline md:bg-surface-primary md:p-[26px] lg:max-w-[440px] lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
            {wide && wideBack && back !== undefined && (
              <nav aria-label="Back" className="mb-[16px]">
                <a href={back} className="text-[12.5px] font-semibold text-trust-indigo">
                  Back
                </a>
              </nav>
            )}
            {/* `.scr-body`: 90px under the last card keeps it clear of the footer on a phone, which a card has no use for. */}
            <main className="flex-1 pt-[16px] pr-[16px] pb-[90px] pl-[16px] md:flex-none md:p-0">
              {children}
            </main>
            {footer !== undefined && (
              <StickyFooter className="md:static md:mt-[16px] md:flex-row md:flex-wrap md:items-center md:gap-[12px] md:bg-none md:p-0 md:[&>.underline]:mx-0 md:[&>:is(a,button):not(.underline)]:min-h-[46px] md:[&>:is(a,button):not(.underline)]:w-auto md:[&>:is(a,button):not(.underline)]:px-[22px] lg:mt-[20px] lg:flex-col lg:items-stretch lg:[&>:is(a,button):not(.underline)]:w-full">
                {footer}
              </StickyFooter>
            )}
          </div>
          {viewport === 'tablet' && tradeCode && (
            <section
              aria-label="Trade Code"
              className="mt-[16px] w-full max-w-[600px] px-[4px] text-[12.5px] text-slate"
            >
              Have a Trade Code?{' '}
              <a href="/find" className="font-bold text-trust-indigo">
                Enter it here
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** TX-01's head: the wordmark, and on log in the headline under it. */
function TabletIntro({ headline }: { headline: boolean }): React.JSX.Element {
  return (
    <header className="mb-[22px] text-center">
      <KomtruLogo size={20} style={{ fontSize: '18px', gap: '8px', justifyContent: 'center' }} />
      {headline && (
        <p className={`${DISPLAY} mt-[14px] mb-0 text-[26px] font-semibold text-midnight-text`}>{HEADLINE}</p>
      )}
    </header>
  );
}

/** DX-01's left column: the story in three points, and the Trade Code entry at the foot. */
function BrandStory({ heading }: { heading: boolean }): React.JSX.Element {
  const Headline = heading ? 'h1' : 'p';
  return (
    <aside aria-label="Why Komtru" className="flex flex-1 flex-col gap-[22px]">
      <KomtruLogo size={20} style={{ fontSize: '18px', gap: '8px' }} />
      <Headline className={`${DISPLAY} m-0 max-w-[420px] text-[34px] leading-[1.1] font-semibold`}>
        {HEADLINE}
      </Headline>
      <ol className="m-0 flex max-w-[420px] list-none flex-col gap-[14px] p-0">
        {POINTS.map(([point, detail], index) => (
          <li key={point} className="flex gap-[12px]">
            <span
              aria-hidden
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[50%] bg-pure-white/12 text-[12px] font-bold"
            >
              {index + 1}
            </span>
            <span>
              <b className="text-[14px]">{point}</b>
              <span className="mt-[2px] block text-[12.5px] opacity-70">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <TradeCodeEntry />
    </aside>
  );
}

const INVALID = `That isn't a Trade Code. A Trade Code looks like ${TRADE_CODE_EXAMPLE}.`;

/**
 * "Have a Trade Code?": goes to the find-a-trade screen (F-015) with the code, which looks it up on arrival. That screen
 * is behind the session gate, as is the lookup it makes, so a person with no session is sent to log in first and the
 * gate brings them back to it. The line under the field says so, because the drawing's "without an account" is not
 * something the platform lets a stranger do.
 */
function TradeCodeEntry(): React.JSX.Element {
  const router = useRouter();
  const id = useId();
  const [typed, setTyped] = useState('');
  const [invalid, setInvalid] = useState(false);

  return (
    <form
      role="search"
      aria-label="Find a trade by its code"
      noValidate
      className="mt-auto max-w-[420px] rounded-[14px] bg-pure-white/8 p-[16px]"
      onSubmit={(event) => {
        event.preventDefault();
        const code = tradeCodeOf(typed.trim());
        setInvalid(code === undefined);
        if (code !== undefined) router.push(`/find?code=${encodeURIComponent(code)}`);
      }}
    >
      <label htmlFor={id} className="mb-[8px] block text-[12px] opacity-75">
        Have a Trade Code?
      </label>
      <div className="flex gap-[8px]">
        <input
          id={id}
          name="code"
          value={typed}
          placeholder="KMT-482731"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setInvalid(false);
          }}
          className="min-w-0 flex-1 rounded-sm border-[1.5px] border-solid border-border-hairline bg-surface-secondary px-[14px] py-[12px] font-mono text-[15px] tracking-[.06em] text-midnight-text"
        />
        <button
          type="submit"
          className="cursor-pointer rounded-sm border-none bg-pure-white px-[18px] text-[13.5px] font-semibold text-[var(--komtru-midnight)]"
        >
          Find
        </button>
      </div>
      {invalid && (
        <p role="alert" className="mt-[8px] mb-0 text-[12px] font-semibold">
          {INVALID}
        </p>
      )}
      <p className="mt-[8px] mb-0 text-[11.5px] opacity-70">
        You&apos;ll log in first, then we&apos;ll show the trade.
      </p>
    </form>
  );
}

/**
 * The screen's heading. The reference writes it as a 17px `h2` under a top bar whose title is a
 * `<b>`; it is the page's only heading, so it is the `h1` here, drawn at the reference's size.
 */
export function EntryHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h1 className="mb-[6px] text-[17px] font-semibold">{children}</h1>;
}

export function Lede({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-[20px] text-[12.5px] leading-[1.6] text-slate">{children}</p>;
}

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M4.5 12.5l4.5 4.5L20 6" />
  </svg>
);

const INFO = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

/** `.trust-note-row`: the emerald tick or info mark beside a sentence about how trust works here. */
export function TrustNote({
  icon = 'tick',
  children,
}: {
  icon?: 'tick' | 'info';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-[10px] py-[10px] text-[12px] leading-[1.5] text-slate">
      <span className="mt-[1px] h-[16px] w-[16px] shrink-0 stroke-trust-emerald">
        {icon === 'tick' ? TICK : INFO}
      </span>
      <span>{children}</span>
    </div>
  );
}

/** `.ack-checkbox-row`: a consent the person ticks themselves. Never pre-ticked (NDPA §15). */
export function AckCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="my-[14px] flex items-start gap-[10px] text-left text-[12px] leading-[1.5] text-slate">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-[2px] h-[16px] w-[16px] shrink-0 accent-trust-indigo"
      />
      <span>{children}</span>
    </label>
  );
}

/** A failure the person has to read before they try again. Announced as it appears. */
export function ErrorText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p role="alert" className="mb-[12px] text-[12px] font-semibold text-risk-on-soft">
      {children}
    </p>
  );
}

/** A link in running text, in the reference's indigo. */
export function InlineLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a href={href} className="font-semibold text-trust-indigo">
      {children}
    </a>
  );
}

/**
 * Seconds until a resend is allowed, counting down from when the code went out.
 *
 * The clock is read only in the timer, never while rendering, so a render is a pure function of
 * state. Until the first tick lands the whole wait is shown, which is the right answer for a code
 * that has only just gone out and off by under a second for one that has not.
 */
export function useResendCountdown(sentAt: number | undefined): number {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (sentAt === undefined) return undefined;
    const tick = () => {
      setNow(Date.now());
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [sentAt]);

  if (sentAt === undefined) return 0;
  if (now === null) return RESEND_AFTER_SECONDS;
  return Math.max(0, Math.ceil((sentAt + RESEND_AFTER_SECONDS * 1000 - now) / 1000));
}

/** "Didn't get a code? Resend in 0:24", which turns into the resend control at zero. */
export function ResendLine({
  secondsLeft,
  sending,
  onResend,
}: {
  secondsLeft: number;
  sending: boolean;
  onResend: () => void;
}): React.JSX.Element {
  return (
    <p className="mb-[20px] text-[11.5px] text-trust-gray">
      Didn&apos;t get a code?{' '}
      {secondsLeft > 0 ? (
        <span className="font-semibold text-trust-indigo">Resend in {countdown(secondsLeft)}</span>
      ) : (
        <button
          type="button"
          onClick={onResend}
          disabled={sending}
          className="cursor-pointer border-none bg-transparent p-0 font-semibold text-trust-indigo underline"
        >
          {sending ? 'Sending…' : 'Resend code'}
        </button>
      )}
    </p>
  );
}
