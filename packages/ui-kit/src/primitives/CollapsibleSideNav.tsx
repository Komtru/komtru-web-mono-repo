'use client';

import { useState } from 'react';
import { SideNav, type SideNavProps } from '../shells/SideNav.js';
import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export type CollapsibleSideNavProps = Omit<SideNavProps, 'collapsed' | 'footer'>;

/**
 * `<SideNav>` with v2's Collapse control (DX-03's `.dweb-collapse`): narrows the 180px rail to a
 * 64px rail of icons and back. It is its own client component because the shells are server-only,
 * and a shell that grew state would put a client boundary around every screen in the product.
 */
export function CollapsibleSideNav(props: CollapsibleSideNavProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const name = collapsed ? 'Expand navigation' : 'Collapse navigation';

  return (
    <SideNav
      {...props}
      collapsed={collapsed}
      footer={
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={name}
          title={name}
          onClick={() => setCollapsed(!collapsed)}
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
          {collapsed ? null : 'Collapse'}
        </button>
      }
    />
  );
}
