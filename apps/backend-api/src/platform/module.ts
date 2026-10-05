// A domain module is a folder under src/modules/<name>/ whose index.ts exports one KomtruModule.
// The app mounts every module's routes under /v1 and runs its lifecycle hooks; modules talk to each
// other only through their index.ts (enforced by eslint-rules/module-boundaries.mjs).
import type { Router } from 'express';
import type { HealthCheck } from './health.js';

export interface KomtruModule {
  name: string;
  /** Registers this module's routes on the /v1 router. */
  routes?: (router: Router) => void;
  /** Extra readiness checks the module needs (beyond Postgres and Redis). */
  healthChecks?: HealthCheck[];
  /** Runs at process start, in registry order (e.g. subscribing to events, starting workers). */
  start?: () => Promise<void>;
  /** Runs at shutdown, in reverse registry order. */
  stop?: () => Promise<void>;
}

export const defineModule = (module: KomtruModule): KomtruModule => module;

const assertUniqueNames = (modules: KomtruModule[]): void => {
  const seen = new Set<string>();
  for (const { name } of modules) {
    if (seen.has(name)) throw new Error(`duplicate module "${name}" in the registry`);
    seen.add(name);
  }
};

/** Returns the function createApp uses to mount every module's routes on /v1. */
export function mountModules(modules: KomtruModule[]): (router: Router) => void {
  assertUniqueNames(modules);
  return (router) => {
    for (const module of modules) module.routes?.(router);
  };
}

export const moduleHealthChecks = (modules: KomtruModule[]): HealthCheck[] =>
  modules.flatMap((m) => m.healthChecks ?? []);
