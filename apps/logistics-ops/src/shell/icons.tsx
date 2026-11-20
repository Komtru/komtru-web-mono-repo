// Line icons on ui-kit's 24px grid and stroke. They inherit the item's colour through `currentColor`.
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

export const TEAM_ICON = (
  <Icon>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M16.5 14c2.3.2 4 1.8 4.5 4.5" />
  </Icon>
);

export const SIGN_OUT_ICON = (
  <Icon>
    <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
  </Icon>
);
