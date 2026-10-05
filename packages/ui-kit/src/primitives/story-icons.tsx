/** The reference's own line icons, lifted from the screens each primitive is drawn on. Stories only. */
const base = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' } as const;

export const BriefcaseIcon = (
  <svg {...base} className="h-[24px] w-[24px] stroke-current" strokeLinejoin="round">
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
  </svg>
);

export const AlertIcon = (
  <svg {...base} strokeWidth={2} className="h-[16px] w-[16px] stroke-current">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

export const OfflineIcon = (
  <svg {...base} strokeWidth={2} className="h-[16px] w-[16px] stroke-current">
    <path d="M3 3l18 18" />
    <path d="M8.5 8.5a10 10 0 0 1 11 2M5 12a10 10 0 0 1 2.5-3.3" />
    <path d="M12 16h.01" />
  </svg>
);
