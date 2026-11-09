import { defineKomtruVitest } from '@komtru/config/vitest';

// The harness's own suites were written against the v1 reference and its 210-row index. The default
// is v2; the one test that checks the default clears this.
export default defineKomtruVitest({ test: { env: { KOMTRU_VISUAL_CHECK_REFERENCE: 'v1' } } });
