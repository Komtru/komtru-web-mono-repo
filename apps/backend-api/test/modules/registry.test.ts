// `moduleSeeds` is a second, hand-written copy of the registry: `pnpm db:migrate` has only a
// database, so it cannot build modules that need Redis and a signing key. A copy drifts. The cost of
// drift is silent — a module whose reference data never seeds, and a migrate that still reports
// success — so the two lists are compared here rather than discovered in an environment.
import { describe, expect, it } from 'vitest';
import { moduleSeeds } from '../../src/modules/index.js';
import { testModules } from '../support/modules.js';

describe('the seed registry mirrors the module registry', () => {
  const registry = testModules();

  it('carries every module that declares a seed, in registry order', () => {
    const seedable = registry.filter((module) => module.seed).map((module) => module.name);
    expect(moduleSeeds.filter((module) => module.seed).map((module) => module.name)).toEqual(seedable);
  });

  it('names only modules the registry actually holds', () => {
    const known = registry.map((module) => module.name);
    expect(known).toEqual(expect.arrayContaining(moduleSeeds.map((module) => module.name)));
  });

  it('seeds with the very same hook the module does, so the two cannot diverge', () => {
    for (const seed of moduleSeeds) {
      const module = registry.find((candidate) => candidate.name === seed.name);
      expect(module?.seed).toBe(seed.seed);
    }
  });
});
