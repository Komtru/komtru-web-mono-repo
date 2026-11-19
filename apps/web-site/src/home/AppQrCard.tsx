'use client';

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { AppleIcon, GooglePlayIcon } from '../art/Icons';
import { siteUrl } from '../site/config';

/**
 * "Get the app": a QR code to the waitlist, and the two store badges.
 *
 * The code points at `/waitlist` rather than at a store listing, because neither listing exists
 * yet — that is what "Coming soon" on the badges means, and pointing a QR code at a 404 is a worse
 * first impression than pointing it at the signup.
 *
 * Generated in the browser rather than shipped as an image: it is a hundred bytes of path data and
 * it has to track the site's own origin, which differs between staging and production.
 */
export function AppQrCard(): React.JSX.Element {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(`${siteUrl()}/waitlist`);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, []);

  return (
    <div className="qrb">
      <div
        className="qr"
        role="img"
        aria-label="QR code to join the Komtru waitlist"
        // The generator returns an SVG string, built here from a URL this site owns.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>Get the app</b>
        <p className="note" style={{ margin: '4px 0 12px' }}>
          Scan with your phone camera. Store listings open at launch.
        </p>
        <div className="stores">
          <div className="sb2">
            <AppleIcon />
            <div>
              <small>Coming soon on the</small>
              <b>App Store</b>
            </div>
          </div>
          <div className="sb2">
            <GooglePlayIcon />
            <div>
              <small>Coming soon on</small>
              <b>Google Play</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
