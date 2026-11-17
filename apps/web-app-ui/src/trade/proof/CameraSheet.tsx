'use client';

// PM-2: the camera, guided. Taking a shot inside Komtru names the file as taken on this device, and the guide says what
// each shot is for. The camera can be refused or missing; both leave the same way out, a plain file picker.
import { Button, Chip, Sheet } from '@komtru/ui-kit';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePermission } from '../../account/permissions';
import { CameraPermission } from '../../system/CameraPermission';
import { useCamera } from './camera';
import { captureName, nextShot, shotChips, SHOTS } from './rules';

export interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
  /** How many photos are already attached: the guide's place. */
  photosTaken: number;
  /** A shot was taken. The sheet stays open for the next one. */
  onShot: (file: File) => void;
  /** Files chosen from the gallery instead (the way out when the camera is refused). */
  onPick: (files: File[]) => void;
  /** The category asks for a video that is not there yet. */
  videoNeeded: boolean;
  /** A video was recorded with the device's own recorder. */
  onVideo: (file: File) => void;
}

const PILL =
  'rounded-full bg-[rgba(255,255,255,.14)] px-[10px] py-[5px] text-[11px] font-semibold text-pure-white';
const PICK =
  'inline-flex cursor-pointer items-center justify-center rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-primary px-[16px] py-[12px] text-[13px] font-semibold focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]';

/** Set once this device has been asked, so the explanation is said once and not before every photo. */
const EXPLAINED_KEY = 'komtru.camera.explained';

const wasExplained = (): boolean => {
  try {
    return window.localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberExplained = (): void => {
  try {
    window.localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    // Private mode: the person is asked again next time, which is the safe way to be wrong.
  }
};

/**
 * Mounted only while the sheet is open, so its state (asked, declined) starts afresh every time and the camera is
 * always let go of when it closes.
 */
export function CameraSheet(props: CameraSheetProps): React.JSX.Element | null {
  return props.open ? createPortal(<OpenSheet {...props} />, document.body) : null;
}

function OpenSheet({
  open,
  onClose,
  photosTaken,
  onShot,
  onPick,
  videoNeeded,
  onVideo,
}: CameraSheetProps): React.JSX.Element {
  // SP-M18: the camera is explained just before it is first needed. A browser that already says it is allowed or
  // blocked needs no explaining; one that cannot say (`unknown`) or has not been asked (`prompt`) gets it, once.
  const permission = usePermission('camera');
  const [asked] = useState(wasExplained);
  const [choice, setChoice] = useState<'asking' | 'allowed' | 'declined'>('asking');
  const explaining = choice === 'asking' && !asked && permission !== 'granted' && permission !== 'denied';
  const declined = choice === 'declined';
  const { state, attach, capture } = useCamera(!explaining && !declined);
  const shot = nextShot(photosTaken);
  const trouble = state === 'denied' || state === 'unavailable' || declined;

  const take = () => {
    void capture().then((blob) => {
      if (blob === undefined) return;
      onShot(
        new File([blob], captureName(shot.id, new Date()), { type: 'image/jpeg', lastModified: Date.now() }),
      );
    });
  };

  if (explaining) {
    return (
      <Sheet open={open} onClose={onClose} title="Take photos">
        <CameraPermission
          onAllow={() => {
            rememberExplained();
            setChoice('allowed');
          }}
          onNotNow={() => setChoice('declined')}
        />
      </Sheet>
    );
  }

  // Drawn on the page's body, after the tab bar: the sheet and the bar share a stacking level, and the later one wins.
  return (
    <Sheet open={open} onClose={onClose} title="Take photos">
      <p className="mb-[10px] text-center text-[11px] text-slate">
        {String(Math.min(photosTaken + 1, SHOTS.length))} of {String(SHOTS.length)}
      </p>
      <div className="relative mb-[14px] flex h-[300px] items-center justify-center overflow-hidden rounded-[16px] bg-komtru-midnight">
        {/* A live camera picture has no captions to give: it is the viewfinder, named for assistive technology. */}
        <video
          ref={attach}
          muted
          playsInline
          aria-label="Camera"
          className={`absolute inset-0 h-full w-full object-cover ${state === 'live' ? '' : 'hidden'}`}
        >
          {/* A live camera picture carries no speech to caption. */}
          <track kind="captions" label="No captions" />
        </video>
        {state === 'live' && (
          <>
            <div
              aria-hidden
              className="relative h-[58%] w-[72%] rounded-[12px] border-2 border-dashed border-[rgba(255,255,255,.55)]"
            />
            <span className={`absolute top-[12px] left-[12px] ${PILL}`}>
              Shot {String(Math.min(photosTaken + 1, SHOTS.length))} · {shot.label}
            </span>
          </>
        )}
        {state === 'starting' && !declined && (
          <p role="status" className="px-[24px] text-center text-[12.5px] text-pure-white">
            Opening the camera… If your browser asks, allow it.
          </p>
        )}
        {trouble && (
          <div role="alert" className="px-[24px] text-center text-pure-white">
            <b className="mb-[4px] block text-[14px]">
              {declined
                ? 'No problem'
                : state === 'denied'
                  ? 'The camera is off for Komtru'
                  : 'We couldn’t open a camera'}
            </b>
            <span className="text-[12px] leading-[1.5]">
              {declined
                ? 'Choose photos you took earlier from your gallery instead.'
                : state === 'denied'
                  ? 'Allow the camera in your browser’s settings to take photos here, or choose photos from your gallery.'
                  : 'Another app may be using it. Close it and try again, or choose photos from your gallery.'}
            </span>
          </div>
        )}
      </div>
      <ul aria-label="The shots" className="mb-[14px] flex list-none justify-center gap-[6px] p-0">
        {shotChips(photosTaken).map((chip) => (
          <li key={chip.id}>
            {chip.state === 'later' ? (
              <span className="inline-flex rounded-full bg-surface-secondary px-[10px] py-[5px] text-[11px] font-semibold text-trust-gray">
                {chip.chip}
              </span>
            ) : (
              <Chip tone={chip.state === 'done' ? 'protected' : 'awaiting'} dot={false}>
                {chip.chip}
                {chip.state === 'done' ? ' ✓' : ''}
              </Chip>
            )}
          </li>
        ))}
      </ul>
      <p className="mb-[6px] text-center text-[12px] leading-[1.5] text-slate">{shot.tip}</p>
      <div className="flex justify-center py-[10px]">
        <button
          type="button"
          aria-label="Take photo"
          disabled={state !== 'live'}
          onClick={take}
          className="flex h-[62px] w-[62px] items-center justify-center rounded-[50%] border-4 border-solid border-komtru-midnight bg-transparent p-0 disabled:opacity-40 focus-visible:outline-[2.5px] focus-visible:outline-trust-indigo focus-visible:outline-offset-[3px]"
        >
          <span className="h-[46px] w-[46px] rounded-[50%] bg-komtru-midnight" />
        </button>
      </div>
      <div className="flex flex-col gap-[8px]">
        {trouble && (
          <label className={PICK}>
            Choose from my gallery
            <input
              type="file"
              multiple
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                onPick([...(event.target.files ?? [])]);
                onClose();
              }}
            />
          </label>
        )}
        {videoNeeded && (
          <label className={PICK}>
            Record the video next
            <input
              type="file"
              accept="video/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) onVideo(file);
                onClose();
              }}
            />
          </label>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
