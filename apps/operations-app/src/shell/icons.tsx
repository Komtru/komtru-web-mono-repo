// One line icon per section, drawn on the same 24px grid and stroke as ui-kit's own. They inherit
// the item's colour through `currentColor`, so the active pill needs no icon state of its own.
import type { SectionId } from './nav';

const Icon = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
  >
    {children}
  </svg>
);

export const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
  queue: (
    <Icon>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Icon>
  ),
  trades: (
    <Icon>
      <path d="M7 7h12l-3-3M17 17H5l3 3" />
    </Icon>
  ),
  disputes: (
    <Icon>
      <path d="M12 4v16M5 8h14M5 8l-2 6a3 3 0 0 0 4 0L5 8zM19 8l-2 6a3 3 0 0 0 4 0l-2-6z" />
    </Icon>
  ),
  identity: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M14 10h4M14 14h4M6 16c.6-1.3 1.7-2 3-2s2.4.7 3 2" />
    </Icon>
  ),
  risk: (
    <Icon>
      <path d="M12 3l9 16H3L12 3zM12 10v4M12 17h.01" />
    </Icon>
  ),
  hubs: (
    <Icon>
      <path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  ),
  custody: (
    <Icon>
      <path d="M12 3l8 4v10l-8 4-8-4V7l8-4zM4 7l8 4 8-4M12 11v10" />
    </Icon>
  ),
  payments: (
    <Icon>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </Icon>
  ),
  'trust-graph': (
    <Icon>
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M8 7h8M7 9l4 7M17 9l-4 7" />
    </Icon>
  ),
  audit: (
    <Icon>
      <path d="M6 3h9l4 4v14H6V3zM14 3v5h5M9 13h7M9 17h7" />
    </Icon>
  ),
  policies: (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </Icon>
  ),
  reports: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </Icon>
  ),
};

export const ACCOUNT_ICON = (
  <Icon>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1-4 4-6 7-6s6 2 7 6" />
  </Icon>
);

export const SIGN_OUT_ICON = (
  <Icon>
    <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
  </Icon>
);
