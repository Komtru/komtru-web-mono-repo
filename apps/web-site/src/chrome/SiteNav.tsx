'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { appLink } from '../site/config';
import { NAV_LINKS } from '../site/nav';

/**
 * The header.
 *
 * A client component for three reasons and no others: the shadow that appears once the page has
 * scrolled, the menu that opens under 1160px, and `aria-current` on the link for the page you are
 * on. Everything else it renders is static.
 *
 * The menu closes from the links themselves rather than from an effect watching the route: tapping
 * a link is the event that should close it, and watching `pathname` would leave the menu open for
 * whoever taps the link to the page they are already on.
 *
 * "Log in" and "Start a trade" leave for the app rather than route inside the site, so they are
 * plain anchors: `next/link` would prefetch an origin it does not own.
 */
export function SiteNav(): React.JSX.Element {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`site-nav${scrolled ? ' sc' : ''}`}>
      <div className="w">
        <Link className="logo" href="/" aria-label="Komtru home">
          <Image src="/komtru-logo.png" alt="Komtru" width={106} height={28} priority />
        </Link>
        <div className="lk">
          {NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </div>
        <div className="na">
          <a className="btn bs" href={appLink('/login')}>
            Log in
          </a>
          <a className="btn bp" href={appLink('/signup')}>
            Start a trade
          </a>
          <button
            type="button"
            className="bur"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>
        </div>
      </div>
      <div className={`mm${menuOpen ? ' o' : ''}`} id="site-menu">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {label}
          </Link>
        ))}
        <a href={appLink('/login')}>Log in</a>
      </div>
    </nav>
  );
}
