import { fontVariables } from '@komtru/ui-kit/fonts';
import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import type { Metadata, Viewport } from 'next';
import { DisplayPrefsApplier } from '../src/account/display/DisplayPrefsApplier';
import { bootDisplayPrefs } from '../src/account/display/prefs';
import { Providers } from '../src/shell/Providers';
import './globals.css';

/**
 * The root layout. It draws the document and mounts the two things every screen needs — the three
 * typefaces and the query client — and no shell: which shell a route is drawn in is the route's
 * decision, because a public Trust Passport page and a signed-in screen are not the same page with
 * different contents. The service worker is mounted by the app's own layout, one level down, so it
 * is never installed on the public passport host.
 *
 * It reads no environment. Every value `<Providers>` needs is a `NEXT_PUBLIC_*` one that Next
 * inlines into the client bundle anyway, so it is read where it is used; reading it here would also
 * mean reading it while `next build` prerenders, on a machine whose environment is not the app's.
 */
export const metadata: Metadata = {
  title: { default: 'Komtru', template: '%s · Komtru' },
  description: 'Trade with anyone in Nigeria and get paid, or get your money back.',
  applicationName: 'Komtru',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser chrome, in the brand's own midnight. Read from the token rather than typed: this is
  // the same value `--komtru-midnight` is everywhere else.
  themeColor: KOMTRU_TOKENS['--komtru-midnight'],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    // The inline script sets display attributes on <html> before React has hydrated it, so the server's markup and the
    // browser's differ by design.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* SP-M33: this device's display preferences, applied before first paint rather than after hydration. */}
        <script dangerouslySetInnerHTML={{ __html: `(${bootDisplayPrefs.toString()})()` }} />
      </head>
      <body>
        <DisplayPrefsApplier />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
