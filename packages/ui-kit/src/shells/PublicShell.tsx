import { TopNav } from './TopNav.js';

export interface PublicShellProps {
  /**
   * Omitted draws no header at all, which is D8 exactly — the reference leans on the mock browser
   * chrome above the frame. A real page that wants to say whose it is passes a label, and gets the
   * brand-only bar T5 draws.
   */
  brandLabel?: string;
  brandIcon?: React.ReactNode;
  /** The 280px rail D8 puts the passport hero in. Below `lg` it stacks above the main column. */
  aside?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * D8 — the seller's public profile. The reference's note on it: "No sidebar — this is a public page
 * a buyer lands on cold, so the layout is content-first like a landing page, not an app shell."
 *
 * So there is no navigation here, at any width, and nothing to mark current. The aside comes first
 * in source order because the hero *is* the page's subject: on a phone a buyer should meet the
 * seller before the stock list, not scroll past it.
 */
export function PublicShell({ brandLabel, brandIcon, aside, children }: PublicShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      {brandLabel !== undefined && <TopNav brandLabel={brandLabel} brandIcon={brandIcon} />}
      <div className="flex-1 p-[20px] lg:p-[24px]">
        <div className="flex flex-col items-start gap-[24px] lg:flex-row">
          {aside !== undefined && <aside className="w-full shrink-0 lg:w-[280px]">{aside}</aside>}
          <main className="w-full min-w-0 lg:flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
