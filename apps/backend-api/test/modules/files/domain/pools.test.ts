// M20 §4 and D5-D6: the tables that decide which of the five accounts a file lands in, what a
// category may contain, and which categories are audited on every read.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CONTENT_TYPES,
  AUDITED_CATEGORIES,
  POOL_BY_CATEGORY,
  allowedFormatsFor,
  carriesCaptureMetadata,
  contentTypeForFormat,
  isAllowedContentType,
  isAuditedCategory,
  isRotatingPool,
  poolForCategory,
} from '../../../../src/modules/files/domain/pools.js';
import { FILE_CATEGORIES } from '../../../../src/modules/files/infrastructure/postgres/schema/enums.js';

describe('pool mapping', () => {
  it('maps every category to a pool', () => {
    for (const category of FILE_CATEGORIES) expect(POOL_BY_CATEGORY[category]).toBeDefined();
  });

  it('gives the two low-volume categories their own account for life (D5)', () => {
    expect(poolForCategory('PROFILE_PHOTO')).toBe('PROFILE');
    expect(poolForCategory('CHAT_ATTACHMENT')).toBe('CHAT_ATTACHMENT');
  });

  it('puts every trade-related category, CUSTODY_EVIDENCE included, in the rotated pool', () => {
    for (const category of FILE_CATEGORIES) {
      if (category === 'PROFILE_PHOTO' || category === 'CHAT_ATTACHMENT') continue;
      expect(poolForCategory(category)).toBe('TRADE_ASSET');
    }
  });

  it('rotates only the trade-asset pool', () => {
    expect(isRotatingPool('TRADE_ASSET')).toBe(true);
    expect(isRotatingPool('PROFILE')).toBe(false);
    expect(isRotatingPool('CHAT_ATTACHMENT')).toBe(false);
  });
});

describe('audited categories', () => {
  it('audits exactly the three the ticket names', () => {
    expect([...AUDITED_CATEGORIES].sort()).toEqual(['CUSTODY_EVIDENCE', 'DISPUTE_EVIDENCE', 'KYC_DOCUMENT']);
  });

  it('does not audit a listing image', () => {
    // Three orders of magnitude of listing-image views would bury the KYC and dispute reads the log
    // exists for, and a compliance log nobody can read is not a control.
    expect(isAuditedCategory('LISTING_IMAGE')).toBe(false);
    expect(isAuditedCategory('KYC_DOCUMENT')).toBe(true);
  });
});

describe('content types', () => {
  it('allows only images for a custody photo', () => {
    expect(ALLOWED_CONTENT_TYPES.CUSTODY_EVIDENCE).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('names an allowed list for every category', () => {
    for (const category of FILE_CATEGORIES) expect(ALLOWED_CONTENT_TYPES[category].length).toBeGreaterThan(0);
  });

  it('matches a content type case-insensitively', () => {
    expect(isAllowedContentType('PROFILE_PHOTO', 'IMAGE/JPEG')).toBe(true);
    expect(isAllowedContentType('PROFILE_PHOTO', 'application/pdf')).toBe(false);
  });

  it('translates MIME types into Cloudinary format names, which are not MIME types', () => {
    // Cloudinary's allowed_formats takes `jpg`, never `image/jpeg`; passing a MIME type produces an
    // upload refused for a reason the client cannot act on.
    expect(allowedFormatsFor('KYC_DOCUMENT')).toEqual(['jpg', 'png', 'webp', 'pdf']);
    expect(allowedFormatsFor('PROFILE_PHOTO')).toEqual(['jpg', 'png', 'webp']);
  });

  it('reads a Cloudinary format back as the MIME type it stands for', () => {
    // The finalize job needs the inverse map: Cloudinary reports what it actually received, and that
    // is what the row must end up holding.
    expect(contentTypeForFormat('jpg')).toBe('image/jpeg');
    expect(contentTypeForFormat('JPEG')).toBe('image/jpeg');
    expect(contentTypeForFormat('pdf')).toBe('application/pdf');
    expect(contentTypeForFormat('svg')).toBeUndefined();
  });
});

describe('capture metadata', () => {
  it('applies to the two categories a camera produces', () => {
    expect(carriesCaptureMetadata('CUSTODY_EVIDENCE')).toBe(true);
    expect(carriesCaptureMetadata('PROOF_OF_DELIVERY')).toBe(true);
    expect(carriesCaptureMetadata('LISTING_IMAGE')).toBe(false);
  });
});
