/**
 * The app's "Find a Trade" screen (trade-code F1), hand-ported from the design reference's screen
 * library so the hero's phone shows the product rather than a drawing of it.
 *
 * Written out here rather than injected: the library ships 65 screens behind 275KB of CSS of its
 * own, and the hero shows exactly one of them. Every value below is a design token, so this screen
 * tracks the app's palette the same way the app does.
 *
 * Not interactive, and inside an `aria-hidden` frame: it is a photograph of a screen.
 */
export function FindATradeScreen(): React.JSX.Element {
  return (
    <>
      <div className="scr-topbar">
        <div className="back-btn">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="20"
            height="20"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </div>
        <b>Find a Trade</b>
        <div style={{ width: 32 }} />
      </div>

      <div className="scr-body">
        <div className="info-banner">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span>
            If a seller sent you a link instead of a code, be careful — always verify a Trade by searching its
            code here, not by tapping an unfamiliar link.
          </span>
        </div>

        <div className="scr-field">
          <label>Enter the seller&rsquo;s Trade Code</label>
          <div className="input">KMT-90142</div>
          <div className="helper">Ask the seller for this — it&rsquo;s shown on every Trade they create.</div>
        </div>
      </div>

      <div className="btn-sticky" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="btn-primary" style={{ textAlign: 'center' }}>
          Find Trade
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--slate)', textAlign: 'center', margin: 0 }}>
          Don&rsquo;t have a code?{' '}
          <span style={{ color: 'var(--trust-indigo)', fontWeight: 600 }}>
            Browse a seller&rsquo;s Trust Passport
          </span>
        </p>
      </div>
    </>
  );
}
