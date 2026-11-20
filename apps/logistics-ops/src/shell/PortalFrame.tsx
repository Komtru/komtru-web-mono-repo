'use client';

import { Button, ConsoleShell, EmptyState, type NavItem } from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { appSpec } from '../app-config';
import { destinationFor, parkUrl } from '../auth/park';
import { SIGN_OUT_ICON, TEAM_ICON } from './icons';
import { SECTIONS, type SectionId } from './nav';
import { signOut } from './sign-out';
import { useLogisticsViewer, type LogisticsViewer } from './viewer';

const ICONS: Record<SectionId, React.ReactNode> = { team: TEAM_ICON };

const FOOTER_ITEM =
  'flex min-h-[36px] w-full items-center justify-center gap-[10px] rounded-[7px] border-none bg-transparent px-0 py-0 text-[10px] whitespace-nowrap text-slate hover:bg-surface-secondary lg:justify-start lg:px-[10px]';

export interface PortalFrameProps {
  current: SectionId;
  title: string;
  description?: string;
  children: (viewer: LogisticsViewer & { me: NonNullable<LogisticsViewer['me']> }) => React.ReactNode;
}

/**
 * The portal's chrome: `ui-kit`'s desktop console shell, with the company's name as the brand label.
 *
 * The body is drawn only once the platform has said who this is, and it is handed that answer, so no
 * screen can draw a company before it knows which one. A member of Park is sent to the Park app here
 * as well as at sign-in, for a Park Agent who already held a session.
 */
export function PortalFrame({ current, title, description, children }: PortalFrameProps): React.JSX.Element {
  const viewer = useLogisticsViewer();
  const router = useRouter();
  const queries = useQueryClient();

  const park = viewer.me?.company.isDefault === true;
  useEffect(() => {
    if (!park || viewer.me === undefined) return;
    const destination = destinationFor(viewer.me, undefined, appSpec.homePath, parkUrl());
    if (destination.kind === 'park') {
      void signOut().finally(() => window.location.assign(destination.url));
    }
  }, [park, viewer.me]);

  const nav = SECTIONS.map<NavItem>((section) => ({
    label: section.label,
    href: section.href,
    icon: ICONS[section.id],
    ...(section.id === current ? { current: true } : {}),
  }));

  const leave = (): void => {
    void signOut().finally(() => {
      // Everything cached belonged to the person who just left.
      queries.clear();
      router.replace(appSpec.signInPath);
    });
  };

  const footer = (
    <button type="button" title="Sign out" aria-label="Sign out" onClick={leave} className={FOOTER_ITEM}>
      <span aria-hidden className="inline-flex h-[16px] w-[16px] min-w-[16px] stroke-current">
        {SIGN_OUT_ICON}
      </span>
      <span className="hidden lg:inline">Sign out</span>
    </button>
  );

  let body: React.ReactNode;
  if (viewer.loading || park) {
    body = (
      <p role="status" className="text-[12px] text-slate">
        {park ? 'Taking you to the Park app…' : 'Checking your access…'}
      </p>
    );
  } else if (viewer.me === undefined) {
    body = (
      <EmptyState
        tone="error"
        title="This account isn't attached to a logistics company"
        body="Your company may have removed you from its team. Ask your company admin, or sign in with another account."
        action={
          <Button type="button" onClick={leave}>
            Sign in again
          </Button>
        }
      />
    );
  } else {
    body = children({ ...viewer, me: viewer.me });
  }

  return (
    <ConsoleShell
      brandLabel="Komtru Logistics"
      nav={nav}
      navLabel="Portal"
      navFooter={footer}
      title={title}
      {...(description === undefined ? {} : { description })}
    >
      {body}
    </ConsoleShell>
  );
}
