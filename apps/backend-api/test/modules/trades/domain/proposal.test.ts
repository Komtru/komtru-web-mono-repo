import { describe, expect, it } from 'vitest';
import {
  checkProofMedia,
  otherRole,
  sideOf,
  userForRole,
} from '../../../../src/modules/trades/domain/proposal.js';
import {
  addressRequiredError,
  proofMediaRequiredError,
} from '../../../../src/modules/trades/domain/errors.js';

describe('checkProofMedia (W1)', () => {
  const img = { contentType: 'image/jpeg' };
  const vid = { contentType: 'video/mp4' };

  it('passes when the photo count is met', () => {
    expect(checkProofMedia({ minPhotos: 2, requireVideo: false }, [img, img])).toEqual({ ok: true });
  });

  it('reports how many photos are missing', () => {
    expect(checkProofMedia({ minPhotos: 3, requireVideo: false }, [img])).toEqual({
      ok: false,
      missingPhotos: 2,
      missingVideo: false,
    });
  });

  it('demands a video when the category does', () => {
    expect(checkProofMedia({ minPhotos: 1, requireVideo: true }, [img])).toEqual({
      ok: false,
      missingPhotos: 0,
      missingVideo: true,
    });
    expect(checkProofMedia({ minPhotos: 1, requireVideo: true }, [img, vid])).toEqual({ ok: true });
  });

  it('still needs one piece of media when the category asks for none', () => {
    expect(checkProofMedia({ minPhotos: 0, requireVideo: false }, [])).toEqual({
      ok: false,
      missingPhotos: 1,
      missingVideo: false,
    });
  });
});

describe('sides', () => {
  const trade = { buyerUserId: 'b', sellerUserId: 's' };
  it('maps users to sides and back', () => {
    expect(sideOf(trade, 'b')).toBe('BUYER');
    expect(sideOf(trade, 's')).toBe('SELLER');
    expect(sideOf(trade, 'x')).toBeNull();
    expect(userForRole(trade, 'SELLER')).toBe('s');
    expect(otherRole('BUYER')).toBe('SELLER');
  });
});

describe('errors', () => {
  it('ADDRESS_REQUIRED is a 422 with its own code', () => {
    const error = addressRequiredError('BUYER');
    expect([error.status, error.code]).toEqual([422, 'ADDRESS_REQUIRED']);
  });
  it('proof media errors name what is missing', () => {
    const error = proofMediaRequiredError({ missingPhotos: 2, missingVideo: true });
    expect([error.status, error.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(error.detail).toContain('2 more photos');
    expect(error.detail).toContain('a video');
  });
});
