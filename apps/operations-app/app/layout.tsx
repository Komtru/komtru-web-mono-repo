import { fontVariables } from '@komtru/ui-kit/fonts';
import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import type { Metadata, Viewport } from 'next';
import { Providers } from '../src/shell/Providers';
import './globals.css';

/**
 * The root layout: the document, the three typefaces and the query client, and no shell. Which
 * chrome a route is drawn in is the route's decision: sign-in and the welcome flow are a page on
 * their own, and the console's sections are drawn in `<ConsoleFrame>`.
 *
 * It reads no environment. Every value `<Providers>` needs is a `NEXT_PUBLIC_*` one that Next
 * inlines into the client bundle anyway, so it is read where it is used.
 */
export const metadata: Metadata = {
  title: { default: 'Komtru Ops', template: '%s · Komtru Ops' },
  description: 'The Komtru TrustOps console.',
  applicationName: 'Komtru Ops',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: KOMTRU_TOKENS['--komtru-midnight'],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
