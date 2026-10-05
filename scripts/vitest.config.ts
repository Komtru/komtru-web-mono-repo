import { defineKomtruVitest } from '@komtru/config/vitest';

export default defineKomtruVitest({ test: { root: import.meta.dirname, include: ['test/**/*.test.ts'] } });
