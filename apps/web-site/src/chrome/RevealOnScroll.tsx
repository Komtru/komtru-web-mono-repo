'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Adds `.in` to every `.rv` as it comes into view, which is what plays the reveal.
 *
 * One observer for the whole document rather than a wrapper component per element: the elements
 * are server-rendered and there are dozens of them, and making each one a client component to
 * watch itself would ship the page's markup to the browser twice over.
 *
 * It unobserves on the way in, so the reveal plays once and scrolling back up does not replay it.
 *
 * Renders nothing. If the browser has no `IntersectionObserver`, every `.rv` is revealed outright
 * — the alternative is a page whose content is permanently at opacity 0.
 */
export function RevealOnScroll(): null {
  const pathname = usePathname();

  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>('.rv:not(.in)');

    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }),
      { threshold: 0.1 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // Re-run per page: a client navigation replaces the elements this was watching.
  }, [pathname]);

  return null;
}
