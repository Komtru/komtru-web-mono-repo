'use client';

import { Banner, Button, EmptyState, Skeleton } from '@komtru/ui-kit';

const ALERT = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

const INFO = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const LOCK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <rect x="5" y="11" width="14" height="9" rx="1.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M4.5 12.5l4.5 4.5L20 6" />
  </svg>
);

export const NoteBanner = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <Banner tone="info" icon={INFO} {...(title === undefined ? {} : { title })}>
    {children}
  </Banner>
);

export const WarnBanner = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <Banner tone="warning" icon={LOCK} {...(title === undefined ? {} : { title })}>
    {children}
  </Banner>
);

export const RiskBanner = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <Banner tone="risk" icon={ALERT} {...(title === undefined ? {} : { title })}>
    {children}
  </Banner>
);

export const ReadyBanner = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <Banner tone="success" icon={TICK} {...(title === undefined ? {} : { title })}>
    {children}
  </Banner>
);

/** What a screen shows while its data is on the way: the shape of the page, not a spinner. */
export function LoadingScreen({ label }: { label: string }): React.JSX.Element {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="mx-auto w-full max-w-[480px]">
      <Skeleton width="full" lines={4} />
    </div>
  );
}

/** A read that failed: say so, and offer the one thing that can help. */
export function LoadFailed({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[480px]">
      <EmptyState
        tone="error"
        title={title}
        body={body}
        {...(onRetry === undefined
          ? {}
          : {
              action: (
                <Button type="button" onClick={onRetry}>
                  Try again
                </Button>
              ),
            })}
      />
    </div>
  );
}

/** The column every proposal screen sits in: the reference draws mobile web only, so wider is centred. */
export function Column({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mx-auto w-full max-w-[480px]">{children}</div>;
}
