'use client';

import { Button, EmptyState } from '@komtru/ui-kit';
import { ConsoleFrame } from '../shell/ConsoleFrame';
import { sectionsFor } from '../shell/nav';
import { useStaffViewer } from '../shell/viewer';

const PANEL = 'rounded-md border border-solid border-border-hairline bg-surface-elevated p-[20px]';

/** `.term-row` — a label and its value on one line, hairline between rows. */
function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-[10px] border-b border-solid border-border-hairline py-[9px] text-[12.5px] last:border-b-0">
      <dt className="m-0 font-semibold">{label}</dt>
      <dd className="m-0 max-w-[55%] text-right text-slate">{children}</dd>
    </div>
  );
}

function Panel({
  heading,
  after,
  children,
}: {
  heading: string;
  /** Beside the rows, not among them: a `<dl>` holds term and description groups and nothing else. */
  after?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={heading} className={PANEL}>
      <h2 className="m-0 mb-[10px] text-[14px] font-semibold">{heading}</h2>
      <dl className="m-0">{children}</dl>
      {after}
    </section>
  );
}

/**
 * OP-33, a team member's own page.
 *
 * Two of the reference's four panels are drawn. Security says what is true of every console sign-in
 * and "What I can do" reads the role and permissions the platform returned. Trusted devices and My
 * shift are left out: the platform has no device list or shift roster to read, and a panel of
 * invented rows is worse than no panel. Password age and the session count go the same way.
 */
export function MyAccount(): React.JSX.Element {
  const viewer = useStaffViewer();
  const { me } = viewer;

  const roles = me?.roles.map((role) => role.name).join(', ') ?? '';
  const name = me?.user.displayName ?? me?.user.username ?? undefined;
  const description =
    me === undefined ? undefined : [name, roles === '' ? undefined : roles].filter(Boolean).join(' · ');

  const sections = sectionsFor(viewer.permissions);
  const codes = [...viewer.permissions].sort();

  const permissionList =
    codes.length > 0 ? (
      <details className="mt-[10px] text-[12px] text-slate">
        <summary className="cursor-pointer font-semibold text-midnight-text">See my permissions</summary>
        <ul className="m-0 mt-[8px] grid list-none gap-[4px] p-0 font-mono text-[11px]">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </details>
    ) : null;

  return (
    <ConsoleFrame
      title="My account"
      {...(description === undefined || description === '' ? {} : { description })}
    >
      {me === undefined ? (
        <EmptyState
          tone="error"
          title="We could not load your account"
          body="Your details did not load. Try again, or sign in again."
          action={
            <Button type="button" onClick={viewer.retry}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-[16px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel heading="Security">
            <Row label="Two-step sign-in">On, for every sign-in</Row>
            <Row label="Account">{me.user.username ?? me.user.publicId}</Row>
          </Panel>

          <Panel heading="What I can do" after={permissionList}>
            <Row label="Role">{roles === '' ? 'No role yet' : roles}</Row>
            <Row label="Sections">
              {sections.length === 0 ? 'None yet' : sections.map((section) => section.label).join(', ')}
            </Row>
            <Row label="Permissions">{String(codes.length)}</Row>
          </Panel>
        </div>
      )}
    </ConsoleFrame>
  );
}
