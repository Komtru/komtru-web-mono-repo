'use client';

import { useEffect, useState } from 'react';
import { SideNav, type SideNavProps } from '../shells/SideNav.js';
import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

/** The collapsed state is a per-browser preference, kept so the next screen's fresh shell keeps it. */
const STORAGE_KEY = 'komtru:sidenav-collapsed';

const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const writeCollapsed = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage blocked: the rail still collapses, it just does not remember.
  }
};

export type CollapsibleSideNavProps = Omit<SideNavProps, 'collapsed' | 'footer'>;

/**
 * `<SideNav>` with v2's Collapse control (DX-03's `.dweb-collapse`): narrows the 180px rail to a
 * 64px rail of icons and back. It is its own client component because the shells are server-only,
 * and a shell that grew state would put a client boundary around every screen in the product.
 */
export function CollapsibleSideNav(props: CollapsibleSideNavProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  // Read after mount so the server's markup and the first client render agree.
  useEffect(() => setCollapsed(readCollapsed()), []);
  const toggle = (): void => {
    writeCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };

  return (
    <SideNav
      {...props}
      collapsed={collapsed}
      footer={
        <button
          type="button"
          aria-label="Navigation sidebar"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={toggle}
          className={cx(
            'mt-[12px] flex w-full items-center gap-[9px] rounded-[8px] pt-[9px] pr-[10px] pb-[9px] pl-[10px] text-[12.5px] font-medium text-slate',
            collapsed && 'justify-center',
            FOCUS_RING,
          )}
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            className="h-[15px] w-[15px] stroke-slate"
          >
            <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          </svg>
          {/* The name is constant and `aria-expanded` carries the state, so the visible word is decoration. */}
          <span aria-hidden className={collapsed ? 'sr-only' : undefined}>
            Collapse
          </span>
        </button>
      }
    />
  );
}
