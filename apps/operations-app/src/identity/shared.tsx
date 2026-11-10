'use client';

// The Identity / KYB section's chrome, shared by the queue and the case: the console frame with the
// two views as a strip of links, drawn only for what the viewer may open.
import Link from 'next/link';
import { ConsoleFrame } from '../shell/ConsoleFrame';
import { useStaffViewer } from '../shell/viewer';

export const IDENTITY_TABS = [
  { href: '/identity', label: 'Verification queue', permission: 'verification.view' },
  { href: '/identity/flags', label: 'Duplicate flags', permission: 'duplicate_flag.view' },
] as const;

export const identityHref = (requestId: string): string => `/identity/${requestId}`;

function Tabs({ current }: { current: string }): React.JSX.Element | null {
  const { permissions } = useStaffViewer();
  const tabs = IDENTITY_TABS.filter((tab) => permissions.has(tab.permission));
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Identity views" className="mb-[16px] flex flex-wrap gap-[6px]">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          {...(tab.href === current ? { 'aria-current': 'page' as const } : {})}
          className={
            tab.href === current
              ? 'rounded-full border-[1.5px] border-solid border-trust-indigo bg-trust-indigo-soft px-[12px] py-[7px] text-[12px] font-semibold text-info-on-soft'
              : 'rounded-full border-[1.5px] border-solid border-border-hairline bg-surface-elevated px-[12px] py-[7px] text-[12px] font-semibold text-midnight-text'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export interface IdentityFrameProps {
  tab: (typeof IDENTITY_TABS)[number]['href'] | null;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function IdentityFrame({ tab, title, description, actions, children }: IdentityFrameProps) {
  return (
    <ConsoleFrame
      current="identity"
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    >
      {tab !== null && <Tabs current={tab} />}
      {children}
    </ConsoleFrame>
  );
}
