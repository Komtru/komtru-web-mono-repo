// What a caller may ASK for at upload time. D2 says the uploading module sets the visibility class
// explicitly; it does not say every class is available for every category, and it must not be.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VISIBILITY,
  OWNING_MODULE,
  checkUploadRequest,
} from '../../../../src/modules/files/domain/upload-policy.js';
import { FILE_CATEGORIES } from '../../../../src/modules/files/infrastructure/postgres/schema/enums.js';

describe('checkUploadRequest', () => {
  it('refuses a public KYC document', () => {
    // Legal under D2 as literally written, and obviously wrong: it would publish the uploader's own
    // identity document to anyone holding the file id.
    const refusal = checkUploadRequest({ category: 'KYC_DOCUMENT', visibility: 'PUBLIC', scope: 'CONSUMER' });
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.reason).toContain('PRIVATE_OWNER');
  });

  it('allows a KYC document only as the uploader’s own', () => {
    expect(
      checkUploadRequest({ category: 'KYC_DOCUMENT', visibility: 'PRIVATE_OWNER', scope: 'CONSUMER' }).ok,
    ).toBe(true);
  });

  it('allows a case-scoped custody photo from a logistics session', () => {
    expect(
      checkUploadRequest({ category: 'CUSTODY_EVIDENCE', visibility: 'PRIVATE_CASE', scope: 'LOGISTICS' }).ok,
    ).toBe(true);
  });

  it('refuses a public custody photo', () => {
    expect(
      checkUploadRequest({ category: 'CUSTODY_EVIDENCE', visibility: 'PUBLIC', scope: 'LOGISTICS' }).ok,
    ).toBe(false);
  });

  it('refuses INTERNAL_ONLY from anything but a staff session', () => {
    // A consumer putting bytes into the internal-evidence namespace from outside is the shape of an
    // attack rather than a feature.
    expect(checkUploadRequest({ category: 'OTHER', visibility: 'INTERNAL_ONLY', scope: 'CONSUMER' }).ok).toBe(
      false,
    );
    expect(
      checkUploadRequest({ category: 'OTHER', visibility: 'INTERNAL_ONLY', scope: 'LOGISTICS' }).ok,
    ).toBe(false);
    expect(checkUploadRequest({ category: 'OTHER', visibility: 'INTERNAL_ONLY', scope: 'STAFF' }).ok).toBe(
      true,
    );
  });

  it('declares an allowed visibility list and an owning module for every category', () => {
    for (const category of FILE_CATEGORIES) {
      expect(ALLOWED_VISIBILITY[category].length).toBeGreaterThan(0);
      expect(OWNING_MODULE[category]).toBeTruthy();
    }
  });

  it('attributes a custody photo to park', () => {
    expect(OWNING_MODULE.CUSTODY_EVIDENCE).toBe('park');
  });
});
