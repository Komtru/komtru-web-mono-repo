// The rules of proof capture as pure functions, so the guide, the progress and the photo checks are tested without
// a DOM. The platform decides how much proof a category needs (`proofNeeds`); this decides what to say about it.

/** The guided shots PM-2 walks through, in order. Four is the reference's set; the guide never asks for more. */
export const SHOTS = [
  {
    id: 'front',
    chip: 'Front',
    label: 'Front of the item',
    tip: 'Fill the frame and keep the item in focus. Good light helps.',
  },
  {
    id: 'back',
    chip: 'Back',
    label: 'Back of the item',
    tip: 'Show the back and any camera or ports. Good light helps.',
  },
  {
    id: 'label',
    chip: 'Label',
    label: 'IMEI / serial label',
    tip: 'Fill the frame and keep the label readable. Good light helps.',
  },
  {
    id: 'marks',
    chip: 'Marks',
    label: 'Any marks or scratches',
    tip: 'Show wear up close, so nothing comes as a surprise.',
  },
] as const;

export type ShotId = (typeof SHOTS)[number]['id'];

/** The shot to take next, given how many photos there are: the guide stops at its last shot. */
export const nextShot = (photosTaken: number): (typeof SHOTS)[number] =>
  SHOTS[Math.min(Math.max(photosTaken, 0), SHOTS.length - 1)] as (typeof SHOTS)[number];

/** Each shot as the chip row draws it: done, the one being taken, or still to come. */
export function shotChips(
  photosTaken: number,
): { id: ShotId; chip: string; state: 'done' | 'now' | 'later' }[] {
  const current = Math.min(photosTaken, SHOTS.length - 1);
  return SHOTS.map((shot, index) => ({
    id: shot.id,
    chip: shot.chip,
    state: index < photosTaken ? 'done' : index === current ? 'now' : 'later',
  }));
}

export interface Needs {
  photos: number;
  video: boolean;
}

export interface Progress {
  photos: { have: number; need: number; met: boolean };
  video: { have: number; need: number; met: boolean };
  /** Everything the category asks for is attached. With nothing required, nothing gates. */
  ready: boolean;
}

export function proofProgress(counts: { photos: number; videos: number }, needs: Needs): Progress {
  const videoNeed = needs.video ? 1 : 0;
  const photos = { have: counts.photos, need: needs.photos, met: counts.photos >= needs.photos };
  const video = { have: counts.videos, need: videoNeed, met: counts.videos >= videoNeed };
  return { photos, video, ready: photos.met && video.met };
}

/** "2 of 3", and "4 of 3" once there are extras: the reference counts what is there against what is asked. */
export const ofLabel = (part: { have: number; need: number }): string =>
  `${String(part.have)} of ${String(part.need)}`;

// ---------------------------------------------------------------------------
// The photo check
// ---------------------------------------------------------------------------

/** Shortest side, in pixels, below which a photo cannot show the item or read a label. */
export const MIN_SIDE = 600;
/** A file with nothing in it cannot show anything. */
export const MIN_BYTES = 1;

export type CheckReason = 'NOT_MEDIA' | 'TOO_SMALL' | 'DUPLICATE';

export interface Check {
  ok: boolean;
  reason?: CheckReason;
  /** The line under the file name, in plain words that do not accuse. */
  note?: string;
}

export interface MediaFacts {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
  width?: number;
  height?: number;
}

/** What the file is, as one string a screen can compare to spot the same file added twice. */
export const fingerprint = (facts: Pick<MediaFacts, 'name' | 'size' | 'lastModified'>): string =>
  `${facts.name}|${String(facts.size)}|${String(facts.lastModified ?? 0)}`;

/**
 * Checks a file on the device before it is uploaded. These are the checks this app can honestly make: it is a photo
 * or a video, it is big enough to show something, and it is not the one already added. Whether an image is original
 * is not decided here.
 */
export function checkMedia(facts: MediaFacts, already: readonly string[] = []): Check {
  const video = facts.type.startsWith('video/');
  if (!facts.type.startsWith('image/') && !video) {
    return { ok: false, reason: 'NOT_MEDIA', note: 'This isn’t a photo or a video' };
  }
  if (already.includes(fingerprint(facts))) {
    return { ok: false, reason: 'DUPLICATE', note: 'You’ve already added this one' };
  }
  if (!video) {
    const side =
      facts.width !== undefined && facts.height !== undefined
        ? Math.min(facts.width, facts.height)
        : undefined;
    if (facts.size < MIN_BYTES || (side !== undefined && side < MIN_SIDE)) {
      return { ok: false, reason: 'TOO_SMALL', note: 'Too small to show the item clearly' };
    }
  }
  return { ok: true };
}

/** The pixel size of an image, where the browser can say; nothing where it cannot (the check then skips it). */
export async function readDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== 'function' || !file.type.startsWith('image/')) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}

/** The name a photo taken inside Komtru is given, so it reads as taken on this device. */
export const captureName = (shot: ShotId, at: Date): string => `komtru-${shot}-${String(at.getTime())}.jpg`;
