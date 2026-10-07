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

export const TAB_ICONS: Record<TabId, React.ReactNode> = {
  /** OF1's `.tab` — the parcel. */
  trades: (
    <svg {...TAB}>
      <rect x="4" y="7" width="16" height="12" rx="2.5" />
    </svg>
  ),
  /** P2-D1's "Find" glass: Explore is search and categories. */
  explore: (
    <svg {...TAB}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  /** S1's `.tab` — the storefront grid a certified merchant gets in Explore's place. */
  shop: (
    <svg {...TAB}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  /** AC6's bell. */
  alerts: (
    <svg {...TAB}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" />
    </svg>
  ),
  /**
   * New. The reference's consumer tab bar has four tabs and no Messages among them — AC7 is reached
   * from a trade — so there is no glyph to lift. Drawn in the same idiom: one 24 viewBox, weight 2,
   * round caps, a single path.
   */
  messages: (
    <svg {...TAB}>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4V7z" />
    </svg>
  ),
  /** OF1's `.tab` — the person. */
  account: (
    <svg {...TAB}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  ),
};

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
