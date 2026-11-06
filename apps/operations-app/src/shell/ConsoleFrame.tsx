'use client';

import { Button, ConsoleShell, EmptyState, type NavItem } from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ACCOUNT_ICON, SECTION_ICONS, SIGN_OUT_ICON } from './icons';
import { ACCOUNT_HREF, canOpen, sectionsFor, type SectionId } from './nav';
import { signOut } from './sign-out';
import { useStaffViewer } from './viewer';

export interface ConsoleFrameProps {
  /** Which section this page sits under. Omitted for a page that is no section's, like My account. */
  current?: SectionId;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const FOOTER_ITEM =
  'flex min-h-[36px] w-full items-center justify-center gap-[10px] rounded-[7px] border-none bg-transparent px-0 py-0 text-[10px] whitespace-nowrap text-slate hover:bg-surface-secondary lg:justify-start lg:px-[10px]';

/**
 * The console's chrome for one page: `ConsoleShell`'s rail, filtered to what the signed-in person
 * may open, and the page itself held to the same rule.
 *
 * Both halves read one answer. The rail shows a section when the viewer holds one of its
 * permissions, and the page shows its body only when it would have been in the rail, so a pasted
 * URL meets the same refusal as a hidden item. Neither is the boundary — the backend refuses the
 * calls — but a screen that drew itself and then failed every request would be the worse product.
 *
 * Until the platform has said who this is, the rail is empty and the body says so: nothing
 * appears that the person turns out not to have.
 */
export function ConsoleFrame({
  current,
  title,
  description,
  actions,
  children,
}: ConsoleFrameProps): React.JSX.Element {
  const viewer = useStaffViewer();
  const router = useRouter();
  const queries = useQueryClient();

  const nav = sectionsFor(viewer.permissions).map<NavItem>((section) => ({
    label: section.label,
    href: section.href,
    icon: SECTION_ICONS[section.id],
    ...(section.id === current ? { current: true } : {}),
  }));

  const leave = (): void => {
    void signOut().finally(() => {
      // Everything cached belonged to the person who just left.
      queries.clear();
      router.replace('/sign-in');
    });
  };

  const footer = (
    <>
      <a href={ACCOUNT_HREF} title="My account" aria-label="My account" className={FOOTER_ITEM}>
        <span aria-hidden className="inline-flex h-[16px] w-[16px] min-w-[16px] stroke-current">
          {ACCOUNT_ICON}
        </span>
        <span className="hidden lg:inline">My account</span>
      </a>
      <button type="button" title="Sign out" aria-label="Sign out" onClick={leave} className={FOOTER_ITEM}>
        <span aria-hidden className="inline-flex h-[16px] w-[16px] min-w-[16px] stroke-current">
          {SIGN_OUT_ICON}
        </span>
        <span className="hidden lg:inline">Sign out</span>
      </button>
    </>
  );

  let body: React.ReactNode;
  if (viewer.loading) {
    body = (
      <p role="status" className="text-[12px] text-slate">
        Checking your access…
      </p>
    );
  } else if (current !== undefined && !canOpen(viewer.permissions, current)) {
    body = viewer.failed ? (
      <EmptyState
        tone="error"
        title="We could not check your access"
        body="Your permissions did not load, so nothing in the console is shown. Try again, or sign in again."
        action={
          <Button type="button" onClick={viewer.retry}>
            Try again
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="This section is not part of your role"
        body="Your role does not include this area. If you need it, ask your team lead to review your access."
      />
    );
  } else {
    body = children;
  }

  return (
    <ConsoleShell
      nav={nav}
      navFooter={footer}
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    >
      {body}
    </ConsoleShell>
  );
}
