import type { AccountItemId, TabId } from './nav';

/**
 * The navigations' icons, lifted from the reference's own markup: OF1's tab bar for the tabs, D9's
 * sidebar for the Account sections.
 *
 * None of them sets `stroke`. `ui-kit`'s navigations stroke the wrapper with the state's colour and
 * SVG inherits it, which is what lets one icon be grey in one nav and indigo in another without
 * knowing anything about either.
 */
const ICON = { viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round' } as const;

/** The reference draws its tab-bar glyphs at weight 2 and its sidebar glyphs at 1.8. */
const TAB = { ...ICON, strokeWidth: '2' } as const;
const RAIL = { ...ICON, strokeWidth: '2' } as const;

/** v2's `komtru-mobile-nav` glyphs (7481), drawn at the weight its tab bar uses. */
export const TAB_ICONS: Record<TabId, React.ReactNode> = {
  home: (
    <svg {...TAB} strokeLinejoin="round">
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
    </svg>
  ),
  trades: (
    <svg {...TAB} strokeLinejoin="round">
      <path d="M4 7h15l-3-3" />
      <path d="m19 7-3 3" />
      <path d="M20 17H5l3 3" />
      <path d="m5 17 3-3" />
    </svg>
  ),
  messages: (
    <svg {...TAB} strokeLinejoin="round">
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.3-4A7.5 7.5 0 1 1 20 11.5Z" />
    </svg>
  ),
  discover: (
    <svg {...TAB} strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
      <path d="M11 7v4l2.5 1.5" />
    </svg>
  ),
  account: (
    <svg {...TAB}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  ),
};

/** The mobile tab bar's raised Start Trade action: a plus, drawn heavier so it holds on the blue. */
export const PLUS_ICON: React.ReactNode = (
  <svg {...ICON} strokeWidth="2.6">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** The top bar's bell (`.tb-icon`): where Alerts went when it left the nav. */
export const BELL_ICON: React.ReactNode = (
  <svg {...ICON} strokeWidth="2">
    <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" />
  </svg>
);

export const ACCOUNT_ICONS: Record<AccountItemId, React.ReactNode> = {
  'personal-info': (
    <svg {...RAIL}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  ),
  verification: (
    <svg {...RAIL}>
      <path d="M4.5 12.5l4.5 4.5L20 6" />
    </svg>
  ),
  'trust-history': (
    <svg {...RAIL}>
      <path d="M6 10a6 6 0 1 1 3.3 5.4" />
    </svg>
  ),
  notifications: (
    <svg {...RAIL}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" />
    </svg>
  ),
  security: (
    <svg {...RAIL}>
      <circle cx="10" cy="9" r="3" />
      <path d="M4 20c0-3.3 2.7-6 6-6 1 0 1.9.24 2.7.67" />
      <circle cx="17.5" cy="16.5" r="3.2" />
    </svg>
  ),
  /** SP-M03: a padlock on a page, for what Komtru can use and what it keeps. */
  privacy: (
    <svg {...RAIL} strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  /** SP-M01: the pin the reference draws on a saved address. */
  addresses: (
    <svg {...RAIL} strokeLinejoin="round">
      <path d="M12 21s6.5-5.6 6.5-11A6.5 6.5 0 1 0 5.5 10c0 5.4 6.5 11 6.5 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  ),
  /** SP-M33: a sun, for how bright and how big. */
  display: (
    <svg {...RAIL}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" />
    </svg>
  ),
  /** SP-M12: money coming back round. */
  refunds: (
    <svg {...RAIL} strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
    </svg>
  ),
  /** SP-M13: a page of lines. */
  statements: (
    <svg {...RAIL} strokeLinejoin="round">
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M10 12h5M10 15.5h5" />
    </svg>
  ),
  /** S6's `.tab` — the card. Payouts, for anyone who has sold. */
  payouts: (
    <svg {...RAIL}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  ),
  /** The reference's terminal glyph: a Park Hub is a building, not a role. */
  'park-agent': (
    <svg {...RAIL} strokeLinejoin="round">
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  ),
};
