/**
 * The three icons the reference draws inside the case-review patterns, traced from the HTML path by
 * path. They are `aria-hidden` wherever they are used: each one sits beside the text it illustrates,
 * so announcing it twice would be noise.
 *
 * Stroke is left to the wrapper via `currentColor` — same arrangement as T-012's `Banner`, so a tone
 * change moves one class rather than every icon.
 */

/** `.ai-label svg` — the sun/aperture mark on "AI-suggested — not a decision". */
export function AdvisoryIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
    </svg>
  );
}

/** `.policy-cite svg` — the document mark on "Applied per … §x.y". */
export function PolicyIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

/** `.p13-req .rq-icon svg` — the default evidence mark, used when a row names no icon of its own. */
export function EvidenceIcon(): React.JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 4l8 4-8 4-8-4 8-4z" />
      <path d="M4 12l8 4 8-4" />
    </svg>
  );
}

/** `.search-box svg` — the magnifier in a filter bar. */
export function SearchIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
