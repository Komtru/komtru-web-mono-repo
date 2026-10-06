// Two icons, drawn the way every icon in the reference is: a 24-viewBox stroke path, no fill,
// `currentColor` so the tone circle it sits in decides the colour, `aria-hidden` because the
// heading beside it already says what the screen is.
const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true } as const;

/** WF1's ring: the mark the reference uses when something did not go through. */
export function AlertIcon(): React.JSX.Element {
  return (
    <svg {...ICON} width="24" height="24" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

/** A map pin with nothing on it: the reference's shape for "this is not where you thought". */
export function CompassIcon(): React.JSX.Element {
  return (
    <svg {...ICON} width="24" height="24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  );
}
