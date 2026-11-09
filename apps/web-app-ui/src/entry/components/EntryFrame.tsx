'use client';

import { MobileShell, StickyFooter, TopBar } from '@komtru/ui-kit';
import { useEffect, useState } from 'react';
import { countdown, RESEND_AFTER_SECONDS } from '../flow';

/**
 * Every entry screen's page: `.scr-topbar` with a way back, the body, and the sticky footer that
 * holds the screen's real actions. The reference draws these on mobile web only, so a wider window
 * gets the same column, centred, rather than a desktop layout nobody drew.
 */
export function EntryFrame({
  title,
  back,
  footer,
  children,
}: {
  /** The top bar's name. Omitted for the screens the reference draws without one (E1, TOS2). */
  title?: string;
  back?: string;
  /** The screen's actions. A screen that only reads, such as the full Terms, has none. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[480px]">
      <MobileShell
        header={
          title === undefined ? undefined : (
            <TopBar title={title} {...(back === undefined ? {} : { back: { label: 'Back', href: back } })} />
          )
        }
        {...(footer === undefined ? {} : { footer: <StickyFooter>{footer}</StickyFooter> })}
      >
        {children}
      </MobileShell>
    </div>
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
