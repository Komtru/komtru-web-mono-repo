import { fontVariables } from '@komtru/ui-kit/fonts';
import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import type { Metadata, Viewport } from 'next';
import { Providers } from '../src/shell/Providers';
import './globals.css';

/**
 * The root layout: the document, the typefaces and the query client, and no shell. Sign-in is a page
 * on its own; the portal's screens are drawn in `<PortalFrame>`.
 */
export const metadata: Metadata = {
  title: { default: 'Komtru Logistics', template: '%s · Komtru Logistics' },
  description: 'The Komtru logistics partner portal.',
  applicationName: 'Komtru Logistics',
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
