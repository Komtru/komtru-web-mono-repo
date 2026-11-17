'use client';

import { Button, StatusHero } from '@komtru/ui-kit';
import { TrustNote } from '../entry/components/EntryFrame';

/**
 * SP-M18: the camera is asked for just before it is needed, with the reason in the person's terms. This is what
 * stands before the browser's own prompt, which a page cannot word and cannot take back: "Not now" leaves the camera
 * unasked and offers the gallery instead, so a refusal costs nothing.
 *
 * The reference says the camera is "used only to take photos and scan codes". The proof flow takes photos and nothing
 * scans a code, so the second half is not said. And "change this any time in Privacy & data" is true only as far as that
 * screen says where it stands: a page cannot switch a camera permission, so it points there rather than promise a switch.
 */
export function CameraPermission({
  onAllow,
  onNotNow,
}: {
  onAllow: () => void;
  onNotNow: () => void;
}): React.JSX.Element {
  return (
    <div>
      <StatusHero tone="info" as="h2" title="Allow the camera">
        Photos you take in Komtru are marked as taken on your device, which buyers trust.
      </StatusHero>
      <TrustNote>Used only to take photos for a Trade</TrustNote>
      <TrustNote>You can also pick photos you took earlier</TrustNote>
      <p className="mt-[6px] mb-[14px] text-[11.5px] leading-[1.6] text-trust-gray">
        You can see where this stands in{' '}
        <a href="/account/privacy" className="font-semibold text-info-on-soft">
          Privacy &amp; data
        </a>
        .
      </p>
      <div className="flex flex-col gap-[8px]">
        <Button type="button" onClick={onAllow}>
          Allow the camera
        </Button>
        <Button type="button" variant="secondary" onClick={onNotNow}>
          Not now
        </Button>
      </div>
    </div>
  );
}
