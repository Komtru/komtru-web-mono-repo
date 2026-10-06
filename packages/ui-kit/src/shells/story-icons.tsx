/**
 * The reference's own nav glyphs, lifted from the screens each shell is drawn on. Stories only.
 *
 * None carries a size: a shell sizes the icon on its wrapper (19px in the tab bar, 15px in the
 * sidebar, 16px in a top-bar control) and an `<svg>` with no width fills its box.
 */
const base = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' } as const;

export const TradesIcon = (
  <svg {...base}>
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
  </svg>
);

export const PassportIcon = (
  <svg {...base}>
    <path d="M6 10a6 6 0 1 1 3.3 5.4" />
  </svg>
);

export const AlertsIcon = (
  <svg {...base} strokeWidth={1.8}>
    <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" />
  </svg>
);

export const AccountIcon = (
  <svg {...base}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </svg>
);

export const VerificationIcon = (
  <svg {...base}>
    <path d="M4.5 12.5l4.5 4.5L20 6" />
  </svg>
);

export const SecurityIcon = (
  <svg {...base}>
    <circle cx="10" cy="9" r="3" />
    <path d="M4 20c0-3.3 2.7-6 6-6 1 0 1.9.24 2.7.67" />
    <circle cx="17.5" cy="16.5" r="3.2" />
  </svg>
);

export const OverviewIcon = (
  <svg {...base} strokeWidth={1.8}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" />
    <rect x="13" y="10" width="8" height="11" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const QueueIcon = (
  <svg {...base} strokeWidth={1.8}>
    <path d="M5 5h14v14H5z" />
    <path d="M8 9h8M8 13h6" />
  </svg>
);

export const SignalsIcon = (
  <svg {...base} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v5l3 2" />
  </svg>
);

export const AgentsIcon = (
  <svg {...base} strokeWidth={1.8}>
    <circle cx="8" cy="8" r="3" />
    <path d="M3.5 20c.7-3.4 2.4-5.2 4.5-5.2s3.8 1.8 4.5 5.2" />
    <path d="M15 8h6M18 5v6" />
  </svg>
);

export const SearchIcon = (
  <svg {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

/** `.ko-dweb-item`'s collapse control: a chevron with the rail's own edge beside it. */
export const CollapseIcon = (
  <svg {...base}>
    <path d="M15 6l-6 6 6 6" />
    <path d="M19 6v12" />
  </svg>
);
