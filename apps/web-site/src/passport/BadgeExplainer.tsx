'use client';

import { useRef, useState } from 'react';
import styles from './BadgeExplainer.module.css';

interface Badge {
  readonly name: string;
  /** What the badge actually claims — and, in three of the four, what it does not claim. */
  readonly meaning: string;
}

/** The four badges, verbatim from the reference's `const B` map. */
const BADGES: readonly Badge[] = [
  {
    name: 'Identity verified',
    meaning:
      'Checked through approved verification. It confirms who someone is, not that they’re a trusted seller.',
  },
  {
    name: 'Completed trades',
    meaning: 'Counted from trades that reached completion on Komtru. Earned only through real behaviour.',
  },
  {
    name: 'Fulfilment rate',
    meaning: 'Share of agreed trades fulfilled as agreed, shown with the number of trades behind it.',
  },
  {
    name: 'Problems handled',
    meaning: 'Shows how issues were resolved. A cooperative resolution is an outcome, not an accusation.',
  },
];

const tabId = (index: number): string => `badge-tab-${index}`;
const panelId = (index: number): string => `badge-panel-${index}`;

/**
 * "Tap a badge to see what it means."
 *
 * Three departures from the reference, all deliberate:
 *
 * 1. The reference built the row with `innerHTML` on load and left the explanation element empty
 *    in the document. Every word here is rendered on the server instead — all four names and all
 *    four explanations are in the HTML, the inactive ones `hidden`. The copy is the page's whole
 *    argument about what a badge does and does not claim; it should not depend on JavaScript to
 *    exist, and a crawler should see it.
 * 2. The reference used bare `aria-pressed` buttons, which say "pressed" and nothing about the
 *    paragraph that changed underneath. This is the APG tablist: the tabs announce "selected,
 *    2 of 4", the panel is owned by its tab and is the next stop after it, and the arrow keys,
 *    Home and End move through the row the way a tab strip is expected to.
 * 3. Only one element is focusable in the row at a time (roving `tabIndex`), so Tab leaves the
 *    row rather than walking all four pills.
 */
export function BadgeExplainer(): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Automatic activation: moving focus along the row also selects, as the APG pattern expects. */
  const select = (index: number): void => {
    const next = (index + BADGES.length) % BADGES.length;
    setSelected(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(BADGES.length - 1);
    }
  };

  return (
    <>
      <div className={styles.badges} role="tablist" aria-label="Trust Passport badges" onKeyDown={onKeyDown}>
        {BADGES.map((badge, index) => (
          <button
            key={badge.name}
            type="button"
            role="tab"
            id={tabId(index)}
            className={styles.badge}
            aria-selected={index === selected}
            aria-controls={panelId(index)}
            tabIndex={index === selected ? 0 : -1}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            onClick={() => setSelected(index)}
          >
            {badge.name}
          </button>
        ))}
      </div>

      {BADGES.map((badge, index) => (
        <p
          key={badge.name}
          role="tabpanel"
          id={panelId(index)}
          className={styles.panel}
          aria-labelledby={tabId(index)}
          /* The panel holds nothing focusable, so it takes the focus itself — APG. */
          tabIndex={0}
          hidden={index !== selected}
        >
          {badge.meaning}
        </p>
      ))}
    </>
  );
}
