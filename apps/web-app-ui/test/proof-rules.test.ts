import { describe, expect, it } from 'vitest';
import {
  captureName,
  checkMedia,
  fingerprint,
  nextShot,
  ofLabel,
  proofProgress,
  shotChips,
} from '../src/trade/proof/rules';

describe('the guided shots', () => {
  it('walks front, back, label, marks and stops at the last', () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => nextShot(n).id)).toEqual([
      'front',
      'back',
      'label',
      'marks',
      'marks',
      'marks',
    ]);
  });

  it('marks the shots done, now and later as the reference chips do', () => {
    expect(shotChips(2).map((chip) => chip.state)).toEqual(['done', 'done', 'now', 'later']);
    expect(shotChips(0).map((chip) => chip.state)).toEqual(['now', 'later', 'later', 'later']);
  });
});

describe('progress against what the category asks for', () => {
  it('counts photos and video apart, and is ready only when both are met', () => {
    const needs = { photos: 3, video: true };
    expect(proofProgress({ photos: 2, videos: 0 }, needs).ready).toBe(false);
    expect(proofProgress({ photos: 3, videos: 0 }, needs).ready).toBe(false);
    const done = proofProgress({ photos: 4, videos: 1 }, needs);
    expect(done.ready).toBe(true);
    expect(ofLabel(done.photos)).toBe('4 of 3');
    expect(ofLabel(done.video)).toBe('1 of 1');
  });

  it('asks for no video when the category does not', () => {
    expect(proofProgress({ photos: 1, videos: 0 }, { photos: 1, video: false }).ready).toBe(true);
  });
});

describe('the photo check', () => {
  const photo = { name: 'a.jpg', type: 'image/jpeg', size: 400_000, width: 3000, height: 4000 };

  it('passes a camera-sized photo and any video', () => {
    expect(checkMedia(photo).ok).toBe(true);
    expect(checkMedia({ name: 'v.mp4', type: 'video/mp4', size: 10, lastModified: 1 }).ok).toBe(true);
  });

  it('refuses what is not media, what is too small and what is added twice, without accusing', () => {
    expect(checkMedia({ ...photo, type: 'application/pdf' }).reason).toBe('NOT_MEDIA');
    expect(checkMedia({ ...photo, width: 300, height: 400 }).reason).toBe('TOO_SMALL');
    expect(checkMedia({ ...photo, size: 0 }).reason).toBe('TOO_SMALL');
    const again = checkMedia(photo, [fingerprint(photo)]);
    expect(again).toEqual({ ok: false, reason: 'DUPLICATE', note: 'You’ve already added this one' });
  });

  it('skips the size rule when the browser cannot read the pixels', () => {
    expect(checkMedia({ name: 'a.jpg', type: 'image/jpeg', size: 200_000 }).ok).toBe(true);
  });
});

it('names a photo taken in Komtru so it reads as taken on this device', () => {
  expect(captureName('label', new Date(5))).toBe('komtru-label-5.jpg');
});
