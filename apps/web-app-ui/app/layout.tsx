import { fontVariables } from '@komtru/ui-kit/fonts';
import type { Metadata, Viewport } from 'next';
import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import { readWebAppConfig, webAppEnv } from '../src/app-config';
import { Providers } from '../src/shell/Providers';
import { ServiceWorker } from '../src/shell/ServiceWorker';
import './globals.css';

/**
 * The root layout. It draws the document and mounts the three things every screen needs — the three
 * typefaces, the query client and api-client, and the service worker — and no shell: which shell a
 * route is drawn in is the route's decision, because a public Trust Passport page and a signed-in
 * screen are not the same page with different contents.
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
  const config = readWebAppConfig(webAppEnv());

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Providers
          config={{ apiUrl: config.apiUrl, socketUrl: config.socketUrl, signInPath: config.signInPath }}
        >
          {children}
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
