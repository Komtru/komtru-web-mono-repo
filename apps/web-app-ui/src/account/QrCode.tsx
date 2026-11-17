'use client';

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** The quiet zone the QR standard asks for around the code, in modules. */
const QUIET = 4;

/**
 * A QR code for `value`, drawn as one SVG path from the code's own module matrix (no HTML string, so nothing is
 * injected). Error correction `M`: a phone's authenticator reads it off a screen, where 15% is plenty. It is the
 * `otpauth` URI of a TOTP enrolment, so it is a secret: it is encoded in the browser and never sent anywhere.
 */
export function QrCode({ value, label }: { value: string; label: string }): React.JSX.Element {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) d += `M${String(col + QUIET)} ${String(row + QUIET)}h1v1h-1z`;
      }
    }
    return { size: count + QUIET * 2, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className="h-[140px] w-[140px]"
    >
      <title>{label}</title>
      <path d={path} className="fill-midnight-text" />
    </svg>
  );
}
