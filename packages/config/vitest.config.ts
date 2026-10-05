import { defineKomtruVitest } from './vitest/preset.mjs';

// ESLint with type information is slow on a cold start.
export default defineKomtruVitest({ test: { testTimeout: 30_000 } });
