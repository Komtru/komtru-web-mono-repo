import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import { fontVariables } from '@komtru/ui-kit/fonts';
import type { Metadata, Viewport } from 'next';
import { RevealOnScroll } from '../src/chrome/RevealOnScroll';
import { SiteFooter } from '../src/chrome/SiteFooter';
import { SiteNav } from '../src/chrome/SiteNav';
import { siteUrl } from '../src/site/config';
import './globals.css';

/**
 * The site's document.
 *
 * Header and footer are mounted here rather than per page, because every page on this site has
 * both — unlike the app, where a public passport page and a signed-in screen are not the same
 * page with different contents.
 *
 * `metadataBase` is read here and nowhere else: it is the one value a page's `openGraph` image
 * path is resolved against, and a relative OG URL is ignored by every scraper that reads it.
 */
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: 'Komtru: Helping people online buy and sell, protected',
      template: '%s · Komtru',
    },
    description:
      'Komtru protects your payment until the item you agreed is delivered. Sellers get paid for the Trades they honour. Both sides build a record that people can see and trust.',
    applicationName: 'Komtru',
    openGraph: {
      siteName: 'Komtru',
      type: 'website',
      locale: 'en_NG',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: KOMTRU_TOKENS['--komtru-midnight'],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <SiteNav />
        {children}
        <SiteFooter />
        <RevealOnScroll />
      </body>
    </html>
  );
}
