import { Banner } from './Banner.js';

const MARK = {
  alert: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  tick: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4.5 12.5l4.5 4.5L20 6" />
    </svg>
  ),
} as const;

interface NoticeProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
}

const withTitle = (title: string | undefined) => (title === undefined ? {} : { title });

/** `.info-banner` — a note about how something works. The default voice of a screen's explanation. */
export function NoteBanner({
  icon = MARK.info,
  children,
  title,
  className,
}: NoticeProps & { icon?: React.ReactNode }): React.JSX.Element {
  return (
    <Banner tone="info" icon={icon} {...withTitle(title)} {...(className === undefined ? {} : { className })}>
      {children}
    </Banner>
  );
}

/** `.guard-lock-banner` — something is missing or to be careful of. Draws the reference's alert mark. */
export function WarnBanner({ children, title, className }: NoticeProps): React.JSX.Element {
  return (
    <Banner
      tone="warning"
      icon={MARK.alert}
      {...withTitle(title)}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </Banner>
  );
}

/** An error the person has to read. Announced as an alert. */
export function RiskBanner({ children, title, className }: NoticeProps): React.JSX.Element {
  return (
    <Banner
      tone="risk"
      icon={MARK.alert}
      {...withTitle(title)}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </Banner>
  );
}

/** `.guard-lock-banner.ready` — the gate is open, or the thing is recorded. */
export function ReadyBanner({ children, title, className }: NoticeProps): React.JSX.Element {
  return (
    <Banner
      tone="success"
      icon={MARK.tick}
      {...withTitle(title)}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </Banner>
  );
}
