'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Where the camera stands:
 * - `unsupported`: this browser has no `getUserMedia` (or the page is not secure), so the screen offers the plain
 *   file picker instead and never pretends a camera exists;
 * - `starting`: asked for, not yet answered (the browser's own permission prompt may be showing);
 * - `live`: the stream is running;
 * - `denied`: the person (or the device's policy) refused the camera;
 * - `unavailable`: allowed, but there is no camera to use or it is in use elsewhere.
 */
export type CameraState = 'unsupported' | 'starting' | 'live' | 'denied' | 'unavailable';

export const cameraSupported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

const noSubscription = (): (() => void) => () => undefined;

/**
 * Whether there is a camera API, read after mount: the server cannot know, so it renders the plain-picker branch and
 * the browser switches once it has hydrated (reading `navigator` during render would not match the server's HTML).
 */
export const useCameraSupported = (): boolean =>
  useSyncExternalStore(noSubscription, cameraSupported, () => false);

const DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

export interface Camera {
  state: CameraState;
  /** Put on the `<video>` that shows the live picture (a callback ref, so a screen can wait for the element). */
  attach: (video: HTMLVideoElement | null) => void;
  /** Freezes the current frame as a JPEG. Nothing when the camera is not live. */
  capture: () => Promise<Blob | undefined>;
}

/** Runs the rear camera while `active`, and always lets go of it afterwards (the light must go off). */
export function useCamera(active: boolean): Camera {
  const [video, attach] = useState<HTMLVideoElement | null>(null);
  const [opened, setOpened] = useState<CameraState>('starting');
  const supported = useCameraSupported();

  useEffect(() => {
    if (!active || !supported || video === null) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((got) => {
        if (stopped) {
          got.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        stream = got;
        video.srcObject = got;
        void video.play().catch(() => undefined);
        setOpened('live');
      })
      .catch((error: unknown) => {
        if (stopped) return;
        setOpened(error instanceof DOMException && DENIED.has(error.name) ? 'denied' : 'unavailable');
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      setOpened('starting');
    };
  }, [active, supported, video]);

  const capture = useCallback(async (): Promise<Blob | undefined> => {
    if (video === null || opened !== 'live' || video.videoWidth === 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob ?? undefined);
        },
        'image/jpeg',
        0.92,
      );
    });
  }, [video, opened]);

  return { state: supported ? opened : 'unsupported', attach, capture };
}
